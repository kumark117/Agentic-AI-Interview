# Agentic AI Interview

Production-ready mock interview platform with:

- Next.js frontend (session UI, live interview, report)
- FastAPI backend (session orchestration, evaluation flow, SSE streaming)
- Postgres + Redis support for hosted deployments
- Local-lite mode for fast development without external services

This version is stable without external LLM integration (`v2.0-noLLM` tag).

## Features

- Start interview with candidate profile and max-question control
- Live question/answer loop with streaming event timeline
- Evaluation feedback, confidence, and source attribution
- End report view
- About dialog on frontend showing UI/Product/Backend versions

## Architecture

- `frontend/` - Next.js app
  - `components/` - form/input/report UI pieces
  - `lib/api.ts` - API client and health endpoint calls
  - `lib/sse.ts` - session event stream connection
- `backend/` - FastAPI app
  - `app/api/v1/routes.py` - REST/SSE endpoints
  - `agents/` - interviewer/evaluator/orchestration logic
  - `alembic/` - DB migrations
  - `tests/` - pytest coverage for API and settings logic

## Modes and Environment

Backend supports:

- `local-lite`: SQLite + FakeRedis
- `local-full`: local Postgres + local Redis
- `remote`: managed Postgres + managed Redis

Example env files:

- `backend/.env.local-lite.example`
- `backend/.env.local-full.example`
- `backend/.env.remote.example`
- `frontend/.env.example`

Important hosted values:

- Frontend:
  - `NEXT_PUBLIC_API_BASE=https://<backend-host>/api/v1`
- Backend:
  - `AI_INTERVIEW_MODE=remote`
  - `AI_INTERVIEW_POSTGRES_DSN=postgresql+asyncpg://...`
  - `AI_INTERVIEW_REDIS_DSN=redis://...`
  - `AI_INTERVIEW_CORS_ORIGINS=https://<frontend-host>,http://localhost:3000`

## Local Development

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
copy .env.local-lite.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health check:

```bash
curl http://127.0.0.1:8000/api/v1/health
```

### Frontend

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open:

- `http://localhost:3000`

## Testing

### Backend tests (pytest)

```bash
cd backend
python -m pytest -q
```

Current backend test coverage includes:

- health endpoint
- auth token missing behavior
- duplicate answer conflict
- lock contention behavior
- event sequence monotonicity
- mode and CORS settings normalization

### Frontend tests (Vitest)

```bash
cd frontend
npm install
npm run test
```

Current frontend test coverage includes:

- start interview API call path
- health/version fetch path
- submit-answer error message handling

## Deploy Notes (Render)

- Backend start command should run migrations before app:
  - `python -m alembic upgrade head && python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Frontend needs `NEXT_PUBLIC_API_BASE` at build time.
- If CORS issues appear, verify:
  - exact frontend origin in `AI_INTERVIEW_CORS_ORIGINS`
  - no duplicate conflicting values across service env and env-groups

## LLM Integration Plan (Next Stage)

Planned direction:

1. Introduce provider adapter layer (`mock` + `openai` first)
2. Add LLM config keys (`AI_INTERVIEW_LLM_*`) in backend settings
3. Move interviewer/evaluator outputs to structured JSON contracts
4. Keep deterministic fallback path on timeout/provider failure
5. Roll out by feature flag (`mock` default, enable in staging first)

Detailed task list:

- `TODO.md`
- `TODO-LLM.md`

## Versioning

- Suggested no-LLM baseline tag: `v2.0-noLLM`
- Backend runtime version comes from:
  - `GET /api/v1/health` -> `version`
- Frontend/Product versions are displayed in About dialog for debugging

## License

Internal/project use unless you add a repository license file.
