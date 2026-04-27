from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ai-agentic-interview"
    app_version: str = "3.0"
    release_tag: str = "v3.0-LLM"
    api_prefix: str = "/api/v1"
    mode: str = "local-lite"
    postgres_dsn: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_agentic_interview"
    redis_dsn: str = "redis://localhost:6379/0"
    use_sqlite_local: bool = False
    sqlite_dsn: str = "sqlite+aiosqlite:///./local_dev.db"
    use_fakeredis_local: bool = False
    auto_create_schema: bool = False
    disable_cleanup_worker: bool = False
    lock_ttl_seconds: int = 18
    lock_heartbeat_seconds: int = 5
    lock_retry_attempts: int = 3
    lock_wait_budget_seconds: float = 2.0
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    llm_provider: str = "openai"
    llm_model_interviewer: str = "gpt-4o-mini"
    llm_model_evaluator: str = "gpt-4o-mini"
    llm_api_key: str = ""
    llm_timeout_seconds: float = 8.0
    llm_max_retries: int = 1
    model_config = SettingsConfigDict(env_file=".env", env_prefix="AI_INTERVIEW_", extra="ignore")

    @property
    def effective_use_sqlite_local(self) -> bool:
        if self.mode == "local-lite":
            return True
        if self.mode in {"local-full", "remote"}:
            return False
        return self.use_sqlite_local

    @property
    def effective_use_fakeredis_local(self) -> bool:
        if self.mode == "local-lite":
            return True
        if self.mode in {"local-full", "remote"}:
            return False
        return self.use_fakeredis_local

    @property
    def effective_auto_create_schema(self) -> bool:
        if self.mode == "local-lite":
            return True
        if self.mode in {"local-full", "remote"}:
            return False
        return self.auto_create_schema

    @property
    def effective_disable_cleanup_worker(self) -> bool:
        if self.mode == "local-lite":
            return True
        if self.mode in {"local-full", "remote"}:
            return False
        return self.disable_cleanup_worker

    @property
    def cors_origins_list(self) -> list[str]:
        out: list[str] = []
        for origin in self.cors_origins.split(","):
            o = origin.strip().strip('"').strip("'")
            if o:
                out.append(o)
        return out


settings = Settings()
