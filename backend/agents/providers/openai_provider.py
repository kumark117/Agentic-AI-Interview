import json
import logging
import uuid
from dataclasses import dataclass

import httpx

from app.models.models import Confidence, Difficulty, EvaluationSource, QuestionSource
from app.schemas.api import GeneratedQuestion


logger = logging.getLogger(__name__)


class OpenAIProviderError(Exception):
    pass


@dataclass
class OpenAIEvaluationResult:
    score: float
    feedback: str
    confidence: Confidence
    fallback_flag: bool
    source: EvaluationSource


class OpenAIProvider:
    def __init__(
        self,
        api_key: str,
        interviewer_model: str,
        evaluator_model: str,
        timeout_seconds: float,
    ) -> None:
        self.api_key = api_key
        self.interviewer_model = interviewer_model
        self.evaluator_model = evaluator_model
        self.timeout_seconds = float(timeout_seconds)
        self.base_url = "https://api.openai.com/v1/chat/completions"
        # Chat completions wait on the server for the full body; a single short "total" timeout caused frequent false timeouts.
        self._http_timeout = httpx.Timeout(
            connect=20.0,
            read=self.timeout_seconds,
            write=60.0,
            pool=20.0,
        )

    async def _chat_json(self, model: str, system_prompt: str, user_prompt: str, *, temperature: float = 0.2) -> dict:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
        }
        try:
            async with httpx.AsyncClient(timeout=self._http_timeout) as client:
                response = await client.post(self.base_url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            logger.warning(
                "OpenAI chat timed out (model=%s, read_timeout_s=%s)",
                model,
                self.timeout_seconds,
            )
            raise OpenAIProviderError(
                f"OpenAI request timed out after {self.timeout_seconds:.0f}s (read). "
                "Increase AI_INTERVIEW_LLM_TIMEOUT_SECONDS on the server if the model is slow or prompts are large."
            ) from exc
        except httpx.RequestError as exc:
            logger.warning("OpenAI chat transport error (model=%s): %s", model, exc)
            raise OpenAIProviderError(f"OpenAI request failed: {exc!s}") from exc

        if response.status_code >= 400:
            snippet = response.text[:400]
            logger.warning("OpenAI HTTP %s (model=%s): %s", response.status_code, model, snippet)
            raise OpenAIProviderError(f"OpenAI error {response.status_code}: {snippet}")
        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("OpenAI JSON parse failed (model=%s): %s", model, exc)
            raise OpenAIProviderError("Failed to parse OpenAI JSON response.") from exc

    async def generate_next_question(
        self, current_difficulty: Difficulty, asked_question_texts: list[str] | None = None
    ) -> GeneratedQuestion:
        asked_question_texts = asked_question_texts or []
        system_prompt = (
            "You are a technical interviewer. Return only JSON with keys: "
            "text, difficulty, topic. Difficulty must be easy|medium|hard."
        )
        user_prompt = (
            f"Generate the next interview question.\n"
            f"Target difficulty: {current_difficulty.value}\n"
            f"Do not repeat these recent questions: {asked_question_texts[-4:]}\n"
            "Keep question concise and practical."
        )
        payload = await self._chat_json(self.interviewer_model, system_prompt, user_prompt)
        text = str(payload.get("text", "")).strip()
        if not text:
            raise OpenAIProviderError("Question text missing from OpenAI response.")
        difficulty_raw = str(payload.get("difficulty", current_difficulty.value)).strip().lower()
        difficulty = Difficulty(difficulty_raw) if difficulty_raw in {"easy", "medium", "hard"} else current_difficulty
        topic = str(payload.get("topic", "general_system_design")).strip() or "general_system_design"
        return GeneratedQuestion(
            question_id=f"q_{uuid.uuid4().hex[:8]}",
            text=text,
            difficulty=difficulty,
            topic=topic,
            source=QuestionSource.interviewer_agent,
        )

    async def evaluate_answer(
        self,
        question_text: str,
        answer_text: str,
        previous_score: float | None = None,
    ) -> OpenAIEvaluationResult:
        system_prompt = (
            "You are a strict technical interviewer evaluator. Return only JSON with keys: "
            "score (0..10), feedback, confidence (HIGH|LOW)."
        )
        user_prompt = (
            f"Question: {question_text}\n"
            f"Answer: {answer_text}\n"
            f"Previous score (optional): {previous_score}\n"
            "Score the answer with concise actionable feedback."
        )
        payload = await self._chat_json(self.evaluator_model, system_prompt, user_prompt)
        try:
            score = float(payload.get("score", 5.0))
        except Exception:
            score = 5.0
        score = max(0.0, min(10.0, round(score, 1)))
        feedback = str(payload.get("feedback", "")).strip() or "No feedback generated."
        confidence_raw = str(payload.get("confidence", "LOW")).strip().upper()
        confidence = Confidence.HIGH if confidence_raw == "HIGH" else Confidence.LOW
        return OpenAIEvaluationResult(
            score=score,
            feedback=feedback,
            confidence=confidence,
            fallback_flag=False,
            source=EvaluationSource.llm,
        )

    async def is_gibberish_answer(self, question_text: str, answer_text: str) -> bool:
        """LLM-only gate: true only for obvious abuse (non-language / no words), not wrong or off-topic answers."""
        system_prompt = (
            "You detect obvious abuse answers for a technical interview. Use a VERY narrow definition.\n"
            "Set gibberish to true ONLY if the answer is clearly not real language, for example: "
            "random letters or symbols, keyboard mashing (e.g. asdfgh), unreadable token soup, emoji-only spam, "
            "or empty / whitespace-only after stripping.\n"
            "Set gibberish to false for ANY normal sentence in a human language, including: wrong answers, "
            "very short answers, jokes, small talk, meta comments about the interview or platform, off-topic tangents, "
            "or phrases like \"I don't know\" / \"pass\" — those must continue to normal scoring, not this gate.\n"
            "If unsure, choose gibberish false.\n"
            "Return only JSON: {\"gibberish\": true} or {\"gibberish\": false}."
        )
        user_prompt = (
            f"Question:\n{self._clip_text(question_text, 1200)}\n\nAnswer:\n{self._clip_text(answer_text, 2400)}"
        )
        payload = await self._chat_json(self.evaluator_model, system_prompt, user_prompt, temperature=0.0)
        raw = payload.get("gibberish")
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            return raw.strip().lower() in {"true", "1", "yes"}
        return False

    @staticmethod
    def _clip_text(text: str, max_chars: int) -> str:
        t = text.strip()
        if len(t) <= max_chars:
            return t
        return t[: max_chars - 3] + "..."

    async def correct_answers_report(
        self,
        turns: list[tuple[str, str, str, float]],
    ) -> list[dict[str, str | float]]:
        """One batched LLM call: for each answered question, produce a strong reference answer."""
        if not turns:
            return []

        system_prompt = (
            "You are a senior technical interviewer. For each interview turn, write a concise but complete "
            "reference answer a strong candidate could give — not repeating the candidate's wording, but "
            "covering the key technical points, tradeoffs, and examples where relevant. "
            "Return only JSON with key \"items\": an array of objects with exactly these keys: "
            "question_id (string, must match input), reference_answer (string). "
            "Include one object per input turn, same order as given."
        )
        lines: list[str] = []
        for qid, qtext, atext, score in turns:
            lines.append(
                json.dumps(
                    {
                        "question_id": qid,
                        "question": self._clip_text(qtext, 900),
                        "candidate_answer": self._clip_text(atext, 1200),
                        "score_received": score,
                    },
                    ensure_ascii=False,
                )
            )
        user_prompt = "Turns (JSON lines, one per question):\n" + "\n".join(lines)
        payload = await self._chat_json(self.evaluator_model, system_prompt, user_prompt)
        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            raise OpenAIProviderError("Missing or invalid \"items\" in correct-answers response.")

        by_id: dict[str, str] = {}
        for row in raw_items:
            if not isinstance(row, dict):
                continue
            qid = str(row.get("question_id", "")).strip()
            ref = str(row.get("reference_answer", "")).strip()
            if qid and ref:
                by_id[qid] = ref

        out: list[dict[str, str | float]] = []
        for qid, qtext, atext, score in turns:
            out.append(
                {
                    "question_id": qid,
                    "question": qtext,
                    "candidate_answer": atext,
                    "score_received": score,
                    "reference_answer": by_id.get(qid, "Reference answer was not returned for this question."),
                }
            )
        return out
