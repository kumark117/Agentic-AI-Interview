# Requirements Specification — Agentic AI Interview

**Scope:** Full-stack interview simulator (Next.js frontend, FastAPI backend).  
**Living document:** Aligns with repository defaults (`app_version` / `release_tag` in backend settings and About UI).  
**Related:** [FUNCTIONAL_SPEC.md](./FUNCTIONAL_SPEC.md), historical design note `AI_agentic_interview_func_spec_V5_0_FROZEN.md` (schema-era).

---

## 1. Purpose and goals

### 1.1 Product purpose

Deliver a **credible technical interview practice** environment: configurable candidate profile, adaptive question flow, structured evaluation, live progress feedback, and a **session report** suitable for review or portfolio demonstration.

### 1.2 Primary goals

- **G1 — Session lifecycle:** Create interview session, ask N questions (bounded), accept one answer per question, end with report.
- **G2 — Transparency:** Surface evaluation feedback, confidence, engine mode (mock vs LLM), and provenance where the product exposes it (events, report JSON, About).
- **G3 — Reliability under constraints:** Deterministic fallbacks when LLM is unavailable, misconfigured, slow, or contended (semaphore / queue messaging).
- **G4 — Deployability:** Run locally with minimal setup; run in production with Postgres, Redis, CORS, migrations, and build-time API base URL for the frontend.

### 1.3 Non-goals (current scope)

- Multi-tenant auth, billing, or candidate accounts.
- Proctoring, plagiarism detection, or video.
- Guaranteed fairness or certification of hiring outcomes (tool is **practice / demo**, not a compliance product unless extended).

---

## 2. Stakeholders and users

| Stakeholder | Interest |
|-------------|----------|
| **Candidate / learner** | Practice interviews, readable feedback, stable UI. |
| **Author / maintainer (e.g. Kumar + team)** | Clear env model, tests, tags, documentation, low operational surprise. |
| **Host (e.g. Render)** | Health checks, migrations, secrets via env, horizontal constraints (Redis/DB). |

---

## 3. Functional requirements (summary)

Detailed behavior is in [FUNCTIONAL_SPEC.md](./FUNCTIONAL_SPEC.md). High-level requirement IDs:

| ID | Requirement |
|----|-------------|
| **FR-01** | Start session with validated candidate fields, role, experience, interview type, **interview_mode** (`mock` \| `llm`), and `max_questions` (1–20). |
| **FR-02** | Return `session_id`, `session_token`, first question, and SSE `stream_url`. |
| **FR-03** | Submit answer with `X-Session-Token`; enforce single submission per question; return processing acknowledgment. |
| **FR-04** | Stream session events over SSE with replay support (`Last-Event-ID`). |
| **FR-05** | Optional manual end session; report reflects partial vs complete interview. |
| **FR-06** | Final report includes scores, weighted summary, recommendation when complete, **runtime** summary (mode / engines / fallback), per-row **question_source**, **evaluation_source**, **fallback_flag**. |
| **FR-07** | Health endpoint exposes service name, semantic **version**, and **release_tag**. |
| **FR-08** | Rate limits on session creation; session-scoped lock to avoid concurrent answer processing; LLM path respects capacity controls. |

---

## 4. Non-functional requirements

| ID | Category | Requirement |
|----|----------|-------------|
| **NFR-01** | Performance | Answer path should complete within reasonable time; LLM calls bounded by timeout and retries; queue delay communicated via events when semaphore wait fails. |
| **NFR-02** | Availability | Core flow works in **mock** mode without external LLM. **LLM** mode degrades to mock interviewer/evaluator when provider unavailable. |
| **NFR-03** | Security | Session token required for protected routes; metrics endpoint requires API key; secrets only via environment, not committed. |
| **NFR-04** | Observability | Structured logging for LLM fallbacks; event timeline for UX and debugging. |
| **NFR-05** | Maintainability | Pytest and Vitest cover critical API paths; Alembic for schema evolution in non-lite modes. |
| **NFR-06** | Portability | `local-lite` (SQLite + FakeRedis), `local-full`, `remote` modes documented in root README and `backend/README.md`. |

---

## 5. Constraints and assumptions

- **C1:** Postgres + Redis required for `local-full` and `remote`.
- **C2:** Frontend must know backend base URL at **build** time (`NEXT_PUBLIC_API_BASE`).
- **C3:** `interview_mode` stored in Redis (TTL refreshed on successful answer commit) to avoid DB migration for mode selection; loss of Redis before TTL expiry could theoretically affect mode resolution (mitigated by TTL extension).
- **C4:** OpenAI-compatible provider is the first LLM integration; provider and models configured via `AI_INTERVIEW_LLM_*`.

---

## 6. Versioning and release identifiers

- **Semantic version** (`version`): e.g. `3.0` — user-facing product/API version.
- **Release tag** (`release_tag`): e.g. `v3.0-LLM` — git-style cut identifier, also exposed on `/health` and mirrored in About UI.
- **Git tags:** e.g. `v2.0-noLLM`, `v3.0-LLM` — see root README.

---

## 7. Compliance and data

- Treat **session tokens** and **API keys** as sensitive.
- Interview content may include PII typed by the user (names); no special retention policy is enforced in code beyond database and operational practices of the deployment.

---

## 8. Traceability

| This doc | Functional spec |
|----------|-----------------|
| FR-01–FR-08 | §3 Sessions, §4 Interview loop, §5 Streaming, §6 Report, §7 Health, §8 Errors |
| NFR-01–NFR-06 | §9 Non-functional behavior |
