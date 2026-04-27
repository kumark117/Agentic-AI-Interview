# Agentic AI Interview

Production-oriented **mock + LLM** interview platform:

- **Next.js** frontend (start form, live interview, SSE timeline, report, About)
- **FastAPI** backend (sessions, evaluation, SSE streaming, optional **OpenAI** interviewer/evaluator)
- **PostgreSQL + Redis** for hosted and local-full modes
- **local-lite** (SQLite + FakeRedis) for fast development without Docker

**Current semantic version:** `3.0` · **Release tag:** `v3.0-LLM` (see `GET /api/v1/health` and About dialog).  
**Git tags:** `v3.0-LLM` (LLM path + report provenance), `v2.0-noLLM` (baseline without LLM emphasis).

Formal specs live in **`docs/`**:

- [docs/REQUIREMENTS_SPEC.md](./docs/REQUIREMENTS_SPEC.md) — goals, stakeholders, FR/NFR summary, constraints  
- [docs/FUNCTIONAL_SPEC.md](./docs/FUNCTIONAL_SPEC.md) — screens, API contracts, modes, data flow  

Legacy design note: `AI_agentic_interview_func_spec_V5_0_FROZEN.md` (schema-era); prefer `docs/` for current behavior.

## Features

- Start interview with candidate profile, **max questions** (1–20), and **interview engine** **Mock** vs **LLM** (`interview_mode`)
- Live Q/A loop with **SSE** event timeline (thinking, evaluation, next question, queue delay, completion)
- Scores, confidence, **evaluation source** and **fallback** attribution in events and report
- **Final report** with `runtime` (selected mode, interviewer/evaluator engine, fallback used) and per-question `question_source` / `evaluation_source` / `fallback_flag`
- **About** dialog: UI/product version, backend version + **release_tag** from health, Esc to close
- Rate limits on session creation, per-session **Redis lock** to prevent concurrent answer processing, **LLM semaphore** under load

## Architecture

- `frontend/` — Next.js (App Router)
  - `app/` — routes: `/`, `/interview/[session_id]`, `/report/[session_id]`
  - `components/` — `StartInterviewForm`, interview UI, `ReportView`, panels
  - `lib/api.ts` — REST client; `lib/sse.ts` — SSE; `lib/session-context.tsx` — session store
- `backend/` — FastAPI
  - `app/api/v1/routes.py` — REST + SSE
  - `app/core/config.py` — settings (`AI_INTERVIEW_*`), `app_version`, `release_tag`
  - `agents/` — mock interviewer/evaluator, `providers/openai_provider.py`, orchestration rules
  - `alembic/` — DB migrations
  - `tests/` — pytest (API contract, settings)

## Modes and environment

| `AI_INTERVIEW_MODE` | Database | Redis | Typical use |
|---------------------|----------|-------|-------------|
| `local-lite` | SQLite | FakeRedis | Quick dev, no services |
| `local-full` | Postgres | Redis | Local integration |
| `remote` | Managed Postgres | Managed Redis | Render / similar |

Example env templates:

- `backend/.env.local-lite.example`
- `backend/.env.local-full.example`
- `backend/.env.remote.example`
- `frontend/.env.example`

### Hosted (Render-style) checklist

**Frontend (build-time):**

- `NEXT_PUBLIC_API_BASE=https://<your-backend-host>/api/v1` (no trailing slash on the base host segment before `/api/v1` as you configure it—keep consistent with how you deploy)

**Backend:**

- `AI_INTERVIEW_MODE=remote`
- `AI_INTERVIEW_POSTGRES_DSN=postgresql+asyncpg://...`
- `AI_INTERVIEW_REDIS_DSN=redis://...`
- `AI_INTERVIEW_CORS_ORIGINS=https://<your-frontend-host>,http://localhost:3000` (exact origins; watch env-group vs service overrides)
- **LLM (optional):** `AI_INTERVIEW_LLM_PROVIDER=openai`, `AI_INTERVIEW_LLM_API_KEY`, models, timeout, retries — see `backend/.env.remote.example`

**Optional:** `AI_INTERVIEW_RELEASE_TAG` overrides default cut string from settings (same env prefix as other fields).

## Local development

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
copy .env.local-lite.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health:

```bash
curl http://127.0.0.1:8000/api/v1/health
```

Expect JSON including `"version":"3.0"` and `"release_tag":"v3.0-LLM"` on current `main`.

### Frontend

```bash
cd frontend
npm install
copy .env.example .env.local
```

Set `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api/v1` (or your backend port).

```bash
npm run dev
```

Open `http://localhost:3000`.

## Testing

### Backend

```bash
cd backend
python -m pytest -q
```

Covers health, auth, duplicate answer, session lock, event ordering, settings/CORS normalization, and related contracts.

### Frontend

```bash
cd frontend
npm run test
```

Covers API helpers (start session, health, submit-answer errors).

## Deploy notes (e.g. Render)

- Backend start command should run migrations before the app, for example:  
  `python -m alembic upgrade head && python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Frontend **must** receive `NEXT_PUBLIC_API_BASE` at **build** time.
- CORS: list real browser origins; if problems persist, confirm deploy picked up new settings and no duplicate conflicting env keys.

## Versioning and tags

| Concept | Where |
|---------|--------|
| Semantic version | `backend/app/core/config.py` → `app_version`; mirrored in About UI |
| Release tag | `release_tag` in settings; `GET /api/v1/health` → `release_tag`; About shows UI constant + API value |
| Git | `git tag` → e.g. `v3.0-LLM`; `git show v3.0-LLM` |

## LLM roadmap notes

First slice (OpenAI-style provider, retries, deterministic fallback) is **in tree**. Further ideas may remain in `TODO.md` / `TODO-LLM.md` for prompts, observability, and extra providers.

## License

Internal/project use unless you add a repository license file.
