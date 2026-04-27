# TODO - LLM Integration (Code-Level)

## 1) Config + env wiring

- [ ] Add new settings in `backend/app/core/config.py`:
  - `llm_provider` (`mock` default, `openai` later)
  - `llm_model`
  - `llm_api_key`
  - `llm_timeout_seconds`
  - `llm_max_retries`
- [ ] Add corresponding keys to `backend/.env.remote.example`.
- [ ] Keep local defaults safe (no real key in repo).

## 2) Provider abstraction

- [ ] Create `backend/agents/providers/base.py` with interface methods:
  - `generate_question(...)`
  - `evaluate_answer(...)`
- [ ] Add `backend/agents/providers/mock_provider.py` adapter over existing mock logic.
- [ ] Add `backend/agents/providers/openai_provider.py` (initial real provider).

## 3) Agent integration

- [ ] Update interviewer flow in `backend/agents/interviewer/` to call provider adapter.
- [ ] Update evaluator flow in `backend/agents/evaluator/` to call provider adapter.
- [ ] Keep existing fallback behavior for timeouts/errors.

## 4) Prompt + response contracts

- [ ] Define prompt templates (interviewer + evaluator) under `backend/agents/prompts/`.
- [ ] Force structured JSON responses from LLM.
- [ ] Validate parsed payloads with pydantic schemas before use.
- [ ] Normalize score/confidence into existing enums/ranges.

## 5) Reliability + cost guardrails

- [ ] Enforce request timeout and single retry policy.
- [ ] Limit prompt context window (recent turns only).
- [ ] Add clear fallback event when LLM call fails.
- [ ] Add lightweight telemetry: latency, provider error type, fallback count.

## 6) API + event compatibility

- [ ] Keep `/api/v1/sessions` and stream event contract unchanged for frontend compatibility.
- [ ] Ensure emitted events still include:
  - `thinking`
  - `evaluation_started`
  - `evaluation_completed`
  - `question_generated`
  - `error` / `queue_delay` / `interview_completed`

## 7) Tests

- [ ] Unit tests for provider selection by `AI_INTERVIEW_LLM_PROVIDER`.
- [ ] Unit tests for evaluator parsing/validation fallbacks.
- [ ] Integration test for one full session with `mock` provider.
- [ ] Integration test (mocked external API) for `openai` provider path.

## 8) Rollout plan

- [ ] Stage 1: merge with `mock` default and feature-flagged `openai`.
- [ ] Stage 2: enable `openai` in staging only, monitor latency/error rates.
- [ ] Stage 3: production canary rollout with fallback still enabled.
- [ ] Stage 4: tune prompts/scoring from real interview traces.

