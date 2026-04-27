import json
import uuid
from dataclasses import dataclass

import httpx

from app.models.models import Confidence, Difficulty, EvaluationSource, QuestionSource
from app.schemas.api import GeneratedQuestion


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
        self.timeout_seconds = timeout_seconds
        self.base_url = "https://api.openai.com/v1/chat/completions"

    async def _chat_json(self, model: str, system_prompt: str, user_prompt: str) -> dict:
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
            "temperature": 0.2,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(self.base_url, headers=headers, json=payload)
        if response.status_code >= 400:
            raise OpenAIProviderError(f"OpenAI error {response.status_code}: {response.text[:400]}")
        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
        except Exception as exc:  # pragma: no cover - defensive
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
