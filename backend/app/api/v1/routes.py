import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from agents.evaluator.mock_agent import MockEvaluatorAgent
from agents.interviewer.mock_agent import MockInterviewerAgent
from agents.providers.openai_provider import OpenAIEvaluationResult, OpenAIProvider, OpenAIProviderError
from agents.orchestrator.rules import next_difficulty, recommendation
from agents.streamer.event_service import format_sse, publish_event, replay_events_by_last_event_id
from app.core.config import settings
from app.db.base import get_db_session
from app.models.models import Answer, Confidence, Difficulty, EndReason, Evaluation, EvaluationSource, Event, EventType, Question, QuestionSource, Session, SessionStatus, WeaknessMap
from app.schemas.api import ErrorResponse, GeneratedQuestion, HealthResponse, SessionEventDTO, StartSessionRequest, StartSessionResponse, SubmitAnswerRequest, SubmitAnswerResponse
from app.services.llm_capacity import llm_semaphore
from app.services.lock_service import SessionBusyError, acquire_session_lock, start_lock_heartbeat
from app.services.rate_limit import check_rate_limit
from app.services.redis_client import redis_client

router = APIRouter()
evaluator = MockEvaluatorAgent()
interviewer = MockInterviewerAgent()
INTERVIEW_MODE_KEY = "session:{session_id}:interview_mode"
logger = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class SessionEventLog:
    db: AsyncSession
    session_id: str


async def _publish_engine_notice(sink: SessionEventLog | None, payload: dict) -> None:
    if sink is None:
        return
    await publish_event(sink.db, redis_client, sink.session_id, EventType.engine_notice, payload)


llm_provider = OpenAIProvider(
    api_key=settings.llm_api_key,
    interviewer_model=settings.llm_model_interviewer,
    evaluator_model=settings.llm_model_evaluator,
    timeout_seconds=settings.llm_timeout_seconds,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _require_session(db: AsyncSession, session_id: str, token: str | None, token_name: str = "X-Session-Token") -> Session:
    if not token:
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "message": f"Missing {token_name}"})
    session = await db.get(Session, session_id)
    if not session or session.session_token != token:
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "message": "Invalid session token"})
    return session


async def _get_session_interview_mode(session_id: str) -> str:
    mode = await redis_client.get(INTERVIEW_MODE_KEY.format(session_id=session_id))
    if mode in {"mock", "llm"}:
        return mode
    return "mock"


def _llm_enabled() -> bool:
    return settings.llm_provider.lower() == "openai" and bool(settings.llm_api_key.strip())


def _fallback_evaluation(previous_score: float | None, message: str) -> OpenAIEvaluationResult:
    return OpenAIEvaluationResult(
        score=5.0 if previous_score is None else float(previous_score),
        feedback=message,
        confidence=Confidence.LOW,
        fallback_flag=True,
        source=EvaluationSource.fallback_timeout,
    )


async def _evaluate_with_mode(
    interview_mode: str,
    question_text: str,
    answer_text: str,
    previous_score: float | None,
    *,
    event_log: SessionEventLog | None = None,
) -> OpenAIEvaluationResult:
    if interview_mode != "llm":
        mock_eval = await evaluator.evaluate(question_text, answer_text, previous_score)
        return OpenAIEvaluationResult(
            score=mock_eval.score,
            feedback=mock_eval.feedback,
            confidence=mock_eval.confidence,
            fallback_flag=mock_eval.fallback_flag,
            source=mock_eval.source,
        )

    if not _llm_enabled():
        await _publish_engine_notice(
            event_log,
            {"kind": "llm_fallback", "phase": "evaluation", "message": "LLM disabled or not configured — using deterministic evaluator."},
        )
        return _fallback_evaluation(previous_score, "LLM unavailable. Falling back to deterministic evaluator.")

    attempts = max(0, settings.llm_max_retries) + 1
    last_error: str | None = None
    for attempt in range(attempts):
        try:
            return await llm_provider.evaluate_answer(question_text, answer_text, previous_score)
        except OpenAIProviderError as exc:
            last_error = str(exc)
            logger.warning(
                "LLM evaluation attempt %s/%s failed: %s",
                attempt + 1,
                attempts,
                last_error[:500],
            )
            if attempt + 1 < attempts:
                await _publish_engine_notice(
                    event_log,
                    {
                        "kind": "llm_retry",
                        "phase": "evaluation",
                        "message": f"Retrying LLM evaluation (attempt {attempt + 2} of {attempts})…",
                        "detail": str(exc)[:200],
                    },
                )
    logger.warning("LLM evaluate fallback triggered: %s", last_error)
    await _publish_engine_notice(
        event_log,
        {
            "kind": "llm_fallback",
            "phase": "evaluation",
            "message": "LLM evaluation exhausted retries — using deterministic fallback.",
            "detail": (last_error or "")[:200],
        },
    )
    return _fallback_evaluation(previous_score, "LLM evaluation failed. Used deterministic fallback.")


async def _generate_question_with_mode(
    interview_mode: str,
    current_difficulty: Difficulty,
    previous_questions: list[str],
    *,
    event_log: SessionEventLog | None = None,
) -> GeneratedQuestion:
    if interview_mode != "llm":
        return await interviewer.generate_next_question(current_difficulty, previous_questions)
    if not _llm_enabled():
        await _publish_engine_notice(
            event_log,
            {"kind": "llm_fallback", "phase": "question", "message": "LLM disabled or not configured — using mock question generator."},
        )
        return await interviewer.generate_next_question(current_difficulty, previous_questions)

    attempts = max(0, settings.llm_max_retries) + 1
    last_error: str | None = None
    for attempt in range(attempts):
        try:
            return await llm_provider.generate_next_question(current_difficulty, previous_questions)
        except OpenAIProviderError as exc:
            last_error = str(exc)
            logger.warning(
                "LLM question generation attempt %s/%s failed: %s",
                attempt + 1,
                attempts,
                last_error[:500],
            )
            if attempt + 1 < attempts:
                await _publish_engine_notice(
                    event_log,
                    {
                        "kind": "llm_retry",
                        "phase": "question",
                        "message": f"Retrying LLM question generation (attempt {attempt + 2} of {attempts})…",
                        "detail": str(exc)[:200],
                    },
                )
    logger.warning("LLM question fallback triggered: %s", last_error)
    await _publish_engine_notice(
        event_log,
        {
            "kind": "llm_fallback",
            "phase": "question",
            "message": "LLM question generation exhausted retries — using mock generator.",
            "detail": (last_error or "")[:200],
        },
    )
    return await interviewer.generate_next_question(current_difficulty, previous_questions)


def _seed_question_fallback() -> GeneratedQuestion:
    """Deterministic first question for mock mode or when LLM is not used for Q1."""
    return GeneratedQuestion(
        question_id=f"q_{uuid.uuid4().hex[:8]}",
        text="Explain how React reconciliation works.",
        difficulty=Difficulty.medium,
        topic="react_fundamentals",
        source=QuestionSource.fallback_bank,
    )


async def _first_question_for_session(interview_mode: str) -> GeneratedQuestion:
    if interview_mode != "llm":
        return _seed_question_fallback()
    if not _llm_enabled():
        # Same deterministic first question as before when LLM is not configured.
        return _seed_question_fallback()
    try:
        await asyncio.wait_for(llm_semaphore.acquire(), timeout=2.0)
    except TimeoutError:
        return await interviewer.generate_next_question(Difficulty.medium, [])
    try:
        return await _generate_question_with_mode("llm", Difficulty.medium, [])
    finally:
        llm_semaphore.release()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service=settings.app_name, version=settings.app_version, release_tag=settings.release_tag)


@router.post("/sessions", response_model=StartSessionResponse)
async def create_session(payload: StartSessionRequest, request: Request, db: AsyncSession = Depends(get_db_session)) -> StartSessionResponse:
    client_ip = request.client.host if request.client else "unknown"
    if not await check_rate_limit(redis_client, f"rl:sessions:ip:{client_ip}", 10, 60) or not await check_rate_limit(redis_client, "rl:sessions:global", 50, 60):
        raise HTTPException(status_code=429, detail={"error": "session_creation_rate_limited", "message": "Too many interview sessions are being created. Please try again shortly."})
    now = _now()
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    session_token = f"tok_{uuid.uuid4()}"
    first_q = await _first_question_for_session(payload.interview_mode)
    qid = first_q.question_id
    qtext = first_q.text
    qdiff = first_q.difficulty
    qtopic = first_q.topic
    qsource = first_q.source
    db.add(
        Session(
            session_id=session_id,
            session_token=session_token,
            candidate_id=payload.candidate_id,
            candidate_name=payload.candidate_name,
            role=payload.role,
            experience_level=payload.experience_level,
            interview_type=payload.interview_type,
            status=SessionStatus.QUESTIONING,
            end_reason=None,
            current_question_id=qid,
            current_difficulty=qdiff,
            max_questions=payload.max_questions,
            questions_asked=1,
            last_activity_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    db.add(
        Question(
            question_id=qid,
            session_id=session_id,
            text=qtext,
            difficulty=qdiff,
            topic=qtopic,
            source=qsource,
            created_at=now,
        )
    )
    await db.commit()
    # Keep mode selection per-session in Redis to avoid a schema migration while introducing UI mode choice.
    await redis_client.set(INTERVIEW_MODE_KEY.format(session_id=session_id), payload.interview_mode, ex=60 * 60 * 24 * 7)
    return StartSessionResponse(
        session_id=session_id,
        session_token=session_token,
        status=SessionStatus.QUESTIONING,
        current_question={"question_id": qid, "text": qtext, "difficulty": qdiff},
        stream_url=f"/api/v1/sessions/{session_id}/stream?token={session_token}",
    )


@router.post("/sessions/{session_id}/answers", response_model=SubmitAnswerResponse, responses={409: {"model": ErrorResponse}, 429: {"model": ErrorResponse}, 401: {"model": ErrorResponse}})
async def submit_answer(session_id: str, payload: SubmitAnswerRequest, x_session_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)) -> SubmitAnswerResponse:
    session = await _require_session(db, session_id, x_session_token)
    interview_mode = await _get_session_interview_mode(session_id)
    if session.status != SessionStatus.QUESTIONING:
        raise HTTPException(status_code=409, detail={"error": "invalid_state", "message": "Session is not accepting answers."})
    try:
        async with acquire_session_lock(redis_client, session_id) as lock_token:
            heartbeat = await start_lock_heartbeat(redis_client, session_id, lock_token)
            try:
                if await db.scalar(select(Answer).where(and_(Answer.session_id == session_id, Answer.question_id == payload.question_id))):
                    raise HTTPException(status_code=409, detail={"error": "answer_already_submitted", "message": f"An answer for question {payload.question_id} has already been submitted."})
                session.last_activity_at = _now()
                session.updated_at = _now()
                elog = SessionEventLog(db, session_id)
                await publish_event(db, redis_client, session_id, EventType.thinking, {"message": "Thinking..."})
                await publish_event(db, redis_client, session_id, EventType.evaluation_started, {"question_id": payload.question_id})
                question = await db.get(Question, payload.question_id)
                if question is None or question.session_id != session_id:
                    raise HTTPException(status_code=409, detail={"error": "invalid_question", "message": "Question does not belong to this session."})
                prev = await db.scalar(select(Evaluation.score).where(Evaluation.session_id == session_id).order_by(Evaluation.created_at.desc()).limit(1))

                gibberish_abort = False
                if interview_mode == "llm" and _llm_enabled():
                    try:
                        await asyncio.wait_for(llm_semaphore.acquire(), timeout=2.0)
                    except TimeoutError:
                        pass
                    else:
                        try:
                            gibberish_abort = await llm_provider.is_gibberish_answer(question.text, payload.answer_text)
                        except OpenAIProviderError:
                            gibberish_abort = False
                        finally:
                            llm_semaphore.release()
                if gibberish_abort:
                    now = _now()
                    answer_id = f"ans_{uuid.uuid4().hex[:10]}"
                    db.add(
                        Answer(
                            answer_id=answer_id,
                            session_id=session_id,
                            question_id=payload.question_id,
                            answer_text=payload.answer_text,
                            created_at=now,
                        )
                    )
                    session.status = SessionStatus.END
                    session.end_reason = EndReason.manual
                    session.updated_at = now
                    await publish_event(
                        db,
                        redis_client,
                        session_id,
                        EventType.error,
                        {"message": "Interview ended: answer was not accepted as substantive (LLM check)."},
                    )
                    await publish_event(
                        db,
                        redis_client,
                        session_id,
                        EventType.interview_completed,
                        {"end_reason": EndReason.manual.value, "detail": "gibberish_answer"},
                    )
                    await db.commit()
                    await redis_client.set(INTERVIEW_MODE_KEY.format(session_id=session_id), interview_mode, ex=60 * 60 * 24 * 7)
                    return SubmitAnswerResponse(
                        status="processing",
                        message="Interview ended for non-substantive answer. See stream for details.",
                    )

                if interview_mode == "llm":
                    try:
                        await asyncio.wait_for(llm_semaphore.acquire(), timeout=2.0)
                    except TimeoutError:
                        await publish_event(db, redis_client, session_id, EventType.queue_delay, {"message": "High load (~5-7s delay)"})
                        await _publish_engine_notice(
                            elog,
                            {
                                "kind": "llm_fallback",
                                "phase": "evaluation",
                                "message": "LLM capacity wait timed out — deterministic evaluation used.",
                            },
                        )
                        evaluation = _fallback_evaluation(prev, "LLM queue delay. Used deterministic fallback.")
                    else:
                        try:
                            evaluation = await _evaluate_with_mode(
                                interview_mode, question.text, payload.answer_text, prev, event_log=elog
                            )
                        finally:
                            llm_semaphore.release()
                else:
                    evaluation = await _evaluate_with_mode(interview_mode, question.text, payload.answer_text, prev, event_log=elog)
                answer_id = f"ans_{uuid.uuid4().hex[:10]}"
                db.add(Answer(answer_id=answer_id, session_id=session_id, question_id=payload.question_id, answer_text=payload.answer_text, created_at=_now()))
                db.add(Evaluation(evaluation_id=f"eval_{uuid.uuid4().hex[:10]}", session_id=session_id, question_id=payload.question_id, answer_id=answer_id, score=evaluation.score, feedback=evaluation.feedback, confidence=evaluation.confidence, fallback_flag=evaluation.fallback_flag, source=evaluation.source, created_at=_now()))
                await publish_event(db, redis_client, session_id, EventType.evaluation_completed, {"question_id": payload.question_id, "score": evaluation.score, "feedback": evaluation.feedback, "confidence": evaluation.confidence.value, "fallback_flag": evaluation.fallback_flag, "source": evaluation.source.value})
                if session.questions_asked >= session.max_questions:
                    session.status = SessionStatus.END
                    session.end_reason = EndReason.max_questions_reached
                    session.updated_at = _now()
                    await publish_event(db, redis_client, session_id, EventType.interview_completed, {"end_reason": "max_questions_reached"})
                else:
                    session.current_difficulty = next_difficulty(session.current_difficulty, evaluation.score)
                    previous_questions = (
                        await db.execute(
                            select(Question.text)
                            .where(Question.session_id == session_id)
                            .order_by(Question.created_at.asc())
                        )
                    ).scalars().all()
                    if interview_mode == "llm":
                        try:
                            await asyncio.wait_for(llm_semaphore.acquire(), timeout=2.0)
                        except TimeoutError:
                            await publish_event(db, redis_client, session_id, EventType.queue_delay, {"message": "High load (~5-7s delay)"})
                            await _publish_engine_notice(
                                elog,
                                {
                                    "kind": "llm_fallback",
                                    "phase": "question",
                                    "message": "LLM capacity wait timed out — mock generator used for next question.",
                                },
                            )
                            next_question = await interviewer.generate_next_question(session.current_difficulty, previous_questions)
                        else:
                            try:
                                next_question = await _generate_question_with_mode(
                                    interview_mode, session.current_difficulty, previous_questions, event_log=elog
                                )
                            finally:
                                llm_semaphore.release()
                    else:
                        next_question = await _generate_question_with_mode(
                            interview_mode, session.current_difficulty, previous_questions, event_log=elog
                        )
                    if evaluation.confidence.value == "HIGH" and evaluation.fallback_flag is False:
                        weakness = await db.scalar(select(WeaknessMap).where(and_(WeaknessMap.session_id == session_id, WeaknessMap.topic == question.topic)))
                        if weakness is None:
                            db.add(WeaknessMap(session_id=session_id, topic=question.topic, low_score_count=1 if evaluation.score <= 3 else 0, follow_up_count=0, last_score=evaluation.score, updated_at=_now()))
                        else:
                            if evaluation.score <= 3:
                                weakness.low_score_count += 1
                            weakness.last_score = evaluation.score
                            weakness.updated_at = _now()
                    db.add(Question(question_id=next_question.question_id, session_id=session_id, text=next_question.text, difficulty=next_question.difficulty, topic=next_question.topic, source=next_question.source, created_at=_now()))
                    session.current_question_id = next_question.question_id
                    session.questions_asked += 1
                    session.updated_at = _now()
                    await publish_event(db, redis_client, session_id, EventType.question_generated, {"question_id": next_question.question_id, "text": next_question.text, "difficulty": next_question.difficulty.value})
                await db.commit()
                await redis_client.set(INTERVIEW_MODE_KEY.format(session_id=session_id), interview_mode, ex=60 * 60 * 24 * 7)
            except IntegrityError:
                await db.rollback()
                raise HTTPException(status_code=409, detail={"error": "answer_already_submitted", "message": f"An answer for question {payload.question_id} has already been submitted."})
            finally:
                heartbeat.cancel()
    except SessionBusyError:
        raise HTTPException(status_code=429, detail={"error": "session_busy", "message": "Another turn is already being processed for this session. Please wait for the next question or retry shortly."})
    return SubmitAnswerResponse(status="processing", message="Answer received. Evaluation started. Listen to SSE stream for updates.")


@router.get("/sessions/{session_id}/stream")
async def stream_session_events(request: Request, session_id: str, token: str = Query(...), db: AsyncSession = Depends(get_db_session)) -> StreamingResponse:
    await _require_session(db, session_id, token, token_name="token")
    last_event_id = request.headers.get("last-event-id")
    replay_events = await replay_events_by_last_event_id(db, session_id, last_event_id) if last_event_id else []
    baseline = max((e.event_seq for e in replay_events), default=0)
    if baseline == 0:
        latest = await db.scalar(select(Event.event_seq).where(Event.session_id == session_id).order_by(Event.event_seq.desc()).limit(1))
        baseline = int(latest or 0)

    async def event_generator():
        last_seq = baseline
        for event in replay_events:
            last_seq = max(last_seq, event.event_seq)
            yield format_sse(event)
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(f"session:{session_id}:events")
        try:
            while True:
                if await request.is_disconnected():
                    break
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if message and message.get("type") == "message":
                    event = SessionEventDTO.model_validate(json.loads(message["data"]))
                    last_seq = max(last_seq, event.event_seq)
                    yield format_sse(event)
                    continue
                missing = (await db.execute(select(Event).where(Event.session_id == session_id, Event.event_seq > last_seq).order_by(Event.event_seq.asc()))).scalars().all()
                for row in missing:
                    event = SessionEventDTO(event_id=row.event_id, event_seq=row.event_seq, session_id=row.session_id, event_type=row.event_type, payload=row.payload, created_at=row.created_at)
                    last_seq = max(last_seq, event.event_seq)
                    yield format_sse(event)
                if not missing:
                    await asyncio.sleep(0.5)
        finally:
            await pubsub.unsubscribe(f"session:{session_id}:events")
            await pubsub.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@router.get("/sessions/{session_id}")
async def get_session_details(session_id: str, x_session_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)):
    session = await _require_session(db, session_id, x_session_token)
    average_score = await db.scalar(select(func.avg(Evaluation.score)).where(Evaluation.session_id == session_id))
    return {"session_id": session.session_id, "candidate_id": session.candidate_id, "status": session.status, "role": session.role, "experience_level": session.experience_level, "current_question_id": session.current_question_id, "questions_asked": session.questions_asked, "max_questions": session.max_questions, "average_score": float(average_score or 0.0), "last_activity_at": session.last_activity_at, "created_at": session.created_at, "updated_at": session.updated_at}


@router.post("/sessions/{session_id}/end")
async def end_session(session_id: str, body: dict, x_session_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)):
    session = await _require_session(db, session_id, x_session_token)
    if session.status == SessionStatus.END:
        return {"session_id": session.session_id, "status": SessionStatus.END, "message": "Session already ended."}
    reason = body.get("reason", EndReason.manual.value)
    if reason not in {r.value for r in EndReason}:
        reason = EndReason.manual.value
    session.status = SessionStatus.END
    session.end_reason = EndReason(reason)
    session.updated_at = _now()
    await publish_event(db, redis_client, session_id, EventType.interview_completed, {"end_reason": reason})
    await db.commit()
    return {"session_id": session.session_id, "status": SessionStatus.END, "message": "Interview session ended."}


@router.get("/sessions/{session_id}/report")
async def get_final_report(session_id: str, x_session_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)):
    session = await _require_session(db, session_id, x_session_token)
    interview_mode = await _get_session_interview_mode(session_id)
    rows = (await db.execute(select(Answer, Question, Evaluation).join(Question, Question.question_id == Answer.question_id).join(Evaluation, Evaluation.answer_id == Answer.answer_id).where(Answer.session_id == session_id).order_by(Answer.created_at.asc()))).all()
    total = 0.0
    weighted_total = 0.0
    den = 0.0
    results = []
    interviewer_used_llm = False
    evaluator_used_llm = False
    evaluator_fallback_used = False
    for answer, question, evaluation in rows:
        total += evaluation.score
        w = 1.0 if evaluation.confidence.value == "HIGH" else 0.5
        weighted_total += evaluation.score * w
        den += w
        interviewer_used_llm = interviewer_used_llm or question.source == QuestionSource.interviewer_agent
        evaluator_used_llm = evaluator_used_llm or evaluation.source == EvaluationSource.llm
        evaluator_fallback_used = evaluator_fallback_used or evaluation.fallback_flag
        results.append(
            {
                "question_id": question.question_id,
                "question": question.text,
                "answer": answer.answer_text,
                "score": evaluation.score,
                "confidence": evaluation.confidence.value,
                "feedback": evaluation.feedback,
                "question_source": question.source.value,
                "evaluation_source": evaluation.source.value,
                "fallback_flag": evaluation.fallback_flag,
            }
        )
    overall = round(total / len(results), 2) if results else 0.0
    weighted = round(weighted_total / den, 2) if den else 0.0
    is_complete = session.end_reason in {EndReason.candidate_completed, EndReason.max_questions_reached}
    rec = recommendation(weighted) if is_complete else None
    interviewer_engine = "LLM" if interview_mode == "llm" and interviewer_used_llm else "Mock"
    evaluator_engine = "LLM" if interview_mode == "llm" and evaluator_used_llm else "Mock"
    report = {
        "session_id": session.session_id,
        "candidate_id": session.candidate_id,
        "status": session.status,
        "is_complete": is_complete,
        "end_reason": session.end_reason.value if session.end_reason else None,
        "overall_score": overall,
        "weighted_score": weighted,
        "strengths": ["Clear communication"] if weighted >= 6 else [],
        "weaknesses": ["Needs deeper tradeoff analysis"] if weighted < 7.5 else [],
        "question_results": results,
        "recommendation": rec,
        "runtime": {
            "selected_mode": interview_mode.upper(),
            "interviewer": interviewer_engine,
            "evaluator": evaluator_engine,
            "fallback_used": evaluator_fallback_used,
        },
    }
    if not is_complete:
        report["note"] = "This report is partial. The interview ended before all questions were completed."
    return report


@router.get("/sessions/{session_id}/report/correct-answers")
async def get_correct_answers_report(session_id: str, x_session_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)) -> dict:
    """On-demand LLM-generated reference answers. Only for sessions started in LLM mode."""
    await _require_session(db, session_id, x_session_token)
    interview_mode = await _get_session_interview_mode(session_id)
    if interview_mode != "llm":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "correct_answers_llm_only",
                "message": "Correct answers report is only available for sessions started in LLM mode.",
            },
        )
    if not _llm_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "llm_unavailable",
                "message": "Correct answers report requires a configured OpenAI API key.",
            },
        )

    rows = (
        await db.execute(
            select(Answer, Question, Evaluation)
            .join(Question, Question.question_id == Answer.question_id)
            .outerjoin(Evaluation, and_(Evaluation.answer_id == Answer.answer_id, Evaluation.session_id == session_id))
            .where(Answer.session_id == session_id)
            .order_by(Answer.created_at.asc())
        )
    ).all()
    if not rows:
        return {"session_id": session_id, "interview_mode": "LLM", "generated_at": _now().isoformat(), "items": []}

    turns = [
        (
            question.question_id,
            question.text,
            answer.answer_text,
            float(evaluation.score) if evaluation is not None else 0.0,
        )
        for answer, question, evaluation in rows
    ]
    try:
        items = await llm_provider.correct_answers_report(turns)
    except OpenAIProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "llm_generation_failed", "message": str(exc)},
        ) from exc

    return {
        "session_id": session_id,
        "interview_mode": "LLM",
        "generated_at": _now().isoformat(),
        "items": items,
    }


@router.get("/metrics")
async def metrics(x_api_key: str | None = Header(default=None), db: AsyncSession = Depends(get_db_session)):
    if not x_api_key:
        raise HTTPException(status_code=401, detail={"error": "unauthorized", "message": "Missing X-API-Key"})
    if not await check_rate_limit(redis_client, f"rl:metrics:{x_api_key}", 60, 60):
        raise HTTPException(status_code=429, detail={"error": "rate_limited", "message": "Too many metrics requests for this API key."})
    active_sessions = await db.scalar(select(func.count()).select_from(Session).where(Session.status != SessionStatus.END))
    return {"active_sessions": int(active_sessions or 0), "queue_depth": 0, "avg_evaluator_latency_ms": 0, "avg_interviewer_latency_ms": 0, "llm_calls_in_progress": 0, "redis_status": "ok", "postgres_status": "ok"}
