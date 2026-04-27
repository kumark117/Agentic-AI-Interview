from app.core.config import Settings


def test_cors_origins_list_strips_quotes_and_whitespace() -> None:
    settings = Settings(cors_origins=' "https://a.onrender.com" , \'http://localhost:3000\' ')
    assert settings.cors_origins_list == ["https://a.onrender.com", "http://localhost:3000"]


def test_remote_mode_disables_local_only_flags() -> None:
    settings = Settings(
        mode="remote",
        use_sqlite_local=True,
        use_fakeredis_local=True,
        auto_create_schema=True,
        disable_cleanup_worker=True,
    )
    assert settings.effective_use_sqlite_local is False
    assert settings.effective_use_fakeredis_local is False
    assert settings.effective_auto_create_schema is False
    assert settings.effective_disable_cleanup_worker is False
