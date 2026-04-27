# TODO - Agentic AI Interview

## Now (stability and cleanup)

- [ ] **Render env cleanup**: keep one source of truth per key (avoid duplicate values across service-level vars and env-groups).
- [ ] **CORS hardening**: after envs are stable, remove broad `*.onrender.com` regex and keep explicit origins only.
- [ ] **Migration policy**: decide and document Alembic strategy (`upgrade head` on startup vs controlled migration job).
- [ ] **Version discipline**: maintain `productVersion` / `frontendVersion` constants on each release.
- [ ] **Secret hygiene**: rotate any credentials exposed during debugging and verify no secrets are committed.

## Next (quality and operations)

- [ ] **Smoke tests (frontend)**: add one Playwright/Cypress happy-path test for start -> answer -> report.
- [ ] **API contract checks (backend)**: enforce `/api/v1/health` and `/api/v1/sessions` behavior in CI.
- [ ] **Error UX polish**: improve fallback/error copy for API unavailable, session token missing, and reconnect cases.
- [ ] **Observability**: standardize request IDs + add short "debug runbook" for Render logs and common failures.

## LLM integration plan

### Goal

Replace mock interviewer/evaluator behavior with real LLM-backed responses while keeping deterministic fallbacks.

### Proposed architecture

- [ ] **Provider adapter layer** (`backend/agents/providers/`):
  - `base.py` interface (`generate_question`, `evaluate_answer`)
  - `openai_provider.py` (first implementation)
  - optional `anthropic_provider.py` later
- [ ] **Config keys** (`AI_INTERVIEW_*`):
  - `AI_INTERVIEW_LLM_PROVIDER=openai|mock`
  - `AI_INTERVIEW_LLM_MODEL=<model_name>`
  - `AI_INTERVIEW_LLM_API_KEY=<secret>`
  - `AI_INTERVIEW_LLM_TIMEOUT_SECONDS=8` (example)
  - `AI_INTERVIEW_LLM_MAX_RETRIES=1` (example)
- [ ] **Service wiring**:
  - interviewer agent calls provider to generate next question
  - evaluator agent calls provider to produce score + feedback + confidence
  - keep current fallback behavior on timeout/error (already supported by event model)

### Prompting and guardrails

- [ ] Add structured system prompts for interviewer and evaluator.
- [ ] Require strict JSON output schema from LLM for parsing safety.
- [ ] Validate parsed payload with pydantic before use.
- [ ] Clamp score range and normalize confidence values to current enums.

### Reliability and cost controls

- [ ] Per-request timeout + cancellation propagation.
- [ ] Retry once on transient errors; otherwise emit fallback event.
- [ ] Token budgeting: cap prompt/context size and include only recent turns.
- [ ] Optional lightweight response cache for duplicate evaluation attempts.

### Security

- [ ] Store API keys only in Render env vars / env groups (never in repo).
- [ ] Redact prompts/responses in logs by default; enable verbose logs only in debug mode.

### Rollout steps

- [ ] Phase 1: behind feature flag (`AI_INTERVIEW_LLM_PROVIDER=mock` default).
- [ ] Phase 2: enable LLM in staging with low traffic and monitor latency/error rate.
- [ ] Phase 3: production rollout with fallback enabled.
- [ ] Phase 4: tune prompts/scoring based on real interview traces.
