# Functional Specification — Agentic AI Interview

**Applies to:** `frontend/` (Next.js) and `backend/` (FastAPI).  
**API prefix:** `/api/v1` (unless overridden in deployment).  
**Companion:** [REQUIREMENTS_SPEC.md](./REQUIREMENTS_SPEC.md).

---

## 1. System context

```text
[Browser: Next.js UI]
        |  HTTPS (hosted) or HTTP (local)
        v
[FastAPI] <--> [PostgreSQL]   (sessions, questions, answers, evaluations, events)
        |
        v
      [Redis]   (pub/sub for SSE fanout, rate limits, session locks, interview_mode key)
        |
        optional --> [OpenAI API]  (when interview_mode=llm and LLM configured)
```

---

## 2. Frontend surfaces

### 2.1 Home / start interview (`/`)

- Form: **candidate_id**, **candidate_name** (validated charset and length), **role**, **experience_level**, **interview_type**, **interview_mode** (`mock` | `llm`), **max_questions** (1–20).
- Actions: start session → navigate to live interview route with returned `session_id`.
- **About** modal: product description, tech stack, **UI Version** / **Backend Version** (from `GET /health`), **Product Version**, **Release tag (UI)** (hardcoded cut string), **Release tag (API)** from health; Esc closes modal.

### 2.2 Live interview (`/interview/[session_id]`)

- Displays current question, answer input, feedback panel, event log, status banners.
- Consumes **SSE** from `stream_url` (relative URL resolved against same API base).
- Submits answers via `POST .../sessions/{id}/answers` with `X-Session-Token`.
- Session state held in React context (`session-context`): question, feedback, logs, streaming flags, **questions remaining** style UX as implemented.

### 2.3 Report (`/report/[session_id]`)

- Loads `GET .../sessions/{id}/report` with token from client store / navigation state.
- Renders **Engine and mode** card when `runtime` object present (`selected_mode`, `interviewer`, `evaluator`, `fallback_used`); otherwise shows hint for older API.
- Full report JSON rendered in `<pre>` for transparency.

---

## 3. API — Sessions and health

All JSON bodies and responses follow Pydantic schemas in `backend/app/schemas/api.py` unless noted.

### 3.1 `GET /health`

**Response (`HealthResponse`):**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | e.g. `ok` |
| `service` | string | Application name from settings |
| `version` | string | Semantic version (e.g. `3.0`) |
| `release_tag` | string | Cut tag (e.g. `v3.0-LLM`) |

### 3.2 `POST /sessions`

**Headers:** none required.  
**Rate limits:** per-IP and global (Redis); `429` with structured `detail` on exceed.

**Body (`StartSessionRequest`):**

- `candidate_id`, `candidate_name`, `role` — non-empty trimmed strings; name regex `[A-Za-z .'-]+`, length 2–80.
- `experience_level` — enum: `junior` | `mid` | `senior`.
- `interview_type` — enum per backend model (e.g. `frontend_ai_fullstack`, …).
- `interview_mode` — `mock` | `llm` (default in schema `mock`; UI may default to `llm`).
- `max_questions` — integer 1–20.

**Behavior:**

- Creates `Session` row, first `Question` (seed text), stores `interview_mode` in Redis key `session:{session_id}:interview_mode` with TTL **7 days** (refreshed after successful answer commit).

**Response (`StartSessionResponse`):**

- `session_id`, `session_token`, `status` (`QUESTIONING`), `current_question` (`question_id`, `text`, `difficulty`), `stream_url` (path including `token` query for SSE).

### 3.3 `POST /sessions/{session_id}/answers`

**Headers:** `X-Session-Token: <session_token>`  
**Body:** `{ "question_id", "answer_text" }` (`answer_text` min length 1).

**States:**

- `401` — missing or invalid token.
- `409` — not questioning, duplicate answer, invalid question, integrity conflict.
- `429` — session busy (lock held by another in-flight answer).

**Behavior (summary):**

1. Acquire Redis session lock with heartbeat.
2. Emit events: `thinking`, `evaluation_started`.
3. **Evaluation:** `_evaluate_with_mode` — mock path uses `MockEvaluatorAgent`; LLM path uses `OpenAIProvider` when enabled, else fallback message and deterministic score behavior.
4. Persist `Answer`, `Evaluation`.
5. Emit `evaluation_completed` with score, feedback, confidence, `fallback_flag`, `source`.
6. If `questions_asked >= max_questions`: set session `END`, `end_reason` max questions, emit `interview_completed`.
7. Else: adjust difficulty from rules; optionally update weakness map when confidence HIGH and not fallback; **generate next question** via `_generate_question_with_mode` (LLM with semaphore or mock); persist `Question`, update session counters, emit `question_generated`.
8. Commit; **refresh** Redis `interview_mode` key TTL.

**Response:** `{ "status": "processing", "message": "..." }` — client continues via SSE.

### 3.4 `GET /sessions/{session_id}/stream?token=...`

**Auth:** `token` query must match session (same as `X-Session-Token` value).

**Behavior:**

- `Last-Event-ID` header optional — replays missed events from DB then subscribes to Redis channel `session:{session_id}:events`.
- Server-Sent Events: `text/event-stream`, no buffering hint for proxies.

**Event types (representative):** `thinking`, `evaluation_started`, `evaluation_completed`, `question_generated`, `interview_completed`, `queue_delay`, `error` (per `EventType` enum).

### 3.5 `GET /sessions/{session_id}`

Returns session summary (status, averages, timestamps, etc.) with valid token.

### 3.6 `POST /sessions/{session_id}/end`

Body may include `reason` matching `EndReason` enum; ends session, emits `interview_completed`.

### 3.7 `GET /sessions/{session_id}/report`

**Response (conceptual):**

| Section | Content |
|---------|---------|
| Identity | `session_id`, `candidate_id`, `status` |
| Completion | `is_complete`, `end_reason`, optional `note` for partial |
| Scores | `overall_score`, `weighted_score`, `strengths`, `weaknesses` (heuristic placeholders) |
| `question_results[]` | `question_id`, `question`, `answer`, `score`, `confidence`, `feedback`, `question_source`, `evaluation_source`, `fallback_flag` |
| `recommendation` | Present when interview considered complete |
| `runtime` | `selected_mode`, `interviewer` (`LLM` \| `Mock`), `evaluator`, `fallback_used` |

### 3.8 `GET /metrics`

Requires `X-API-Key`; rate limited; returns aggregate operational counters (placeholders allowed for some fields).

---

## 4. Interview engine modes

| Mode | Interviewer | Evaluator | Notes |
|------|---------------|-----------|--------|
| `mock` | `MockInterviewerAgent` | `MockEvaluatorAgent` | No external API. |
| `llm` | `OpenAIProvider.generate_next_question` when API key + provider enabled; else mock | Same for evaluate | Semaphore limits concurrency; timeout → fallback evaluation / mock question; `queue_delay` event on semaphore timeout. |

**LLM configuration (backend):** `AI_INTERVIEW_LLM_PROVIDER`, `AI_INTERVIEW_LLM_MODEL_*`, `AI_INTERVIEW_LLM_API_KEY`, `AI_INTERVIEW_LLM_TIMEOUT_SECONDS`, `AI_INTERVIEW_LLM_MAX_RETRIES`.

---

## 5. Data model (conceptual)

Entities include **Session**, **Question**, **Answer**, **Evaluation**, **Event**, **WeaknessMap** with enums for status, difficulty, confidence, sources, end reasons. See `backend/app/models/models.py` and Alembic migrations for authoritative definitions.

---

## 6. Frontend ↔ backend contract

- **Base URL:** `NEXT_PUBLIC_API_BASE` (must include `/api/v1` suffix as used in `frontend/lib/api.ts`).
- **CORS:** Backend `AI_INTERVIEW_CORS_ORIGINS` must list exact frontend origins (hosted + local as needed).
- **Types:** `frontend/lib/types.ts` should stay aligned with backend enums and DTOs for compile-time safety.

---

## 7. Error payload shape

Structured errors typically use FastAPI `detail` object: `{ "error": "<code>", "message": "<human text>" }` for 401, 409, 429, etc.

---

## 8. Revision history (documentation)

| Version | Notes |
|---------|--------|
| Doc 1.0 | Written to match post–`v3.0-LLM` behavior (LLM path, report `runtime`, health `release_tag`). |
