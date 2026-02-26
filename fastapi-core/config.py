from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    # OpenAI
    openai_api_key: str = ""

    # Service URLs
    stt_service_url: str = "http://stt-service:8001"
    tts_service_url: str = "http://tts-service:8002"

    # Database
    database_url: str = "sqlite:///./venzio.db"

    # JWT Auth
    secret_key: str = "changeme-use-a-real-secret-key"
    access_token_expire_minutes: int = 60

    # Concurrency
    max_global_sessions: int = 10

    # STT
    whisper_model: str = "small"
    whisper_language: str = "es"

    # TTS defaults (for DB seed)
    default_voice_name: str = "Español Davefx"
    default_voice_file: str = "es_ES-davefx-medium.onnx"

    # LLM
    llm_model: str = "gpt-4o-mini"
    llm_max_tokens: int = 500
    llm_temperature: float = 0.7
    llm_timeout: int = 30

    # Admin seed
    admin_email: str = "admin@venzio.com"
    admin_password: str = "Admin1234!"

    # CORS
    allowed_origins: str = "http://localhost,http://localhost:3000"

    # Email settings
    smtp_server: str = "alphasoft.com.py"
    smtp_port: int = 465
    smtp_username: str = ""
    smtp_password: str = ""
    contact_email: str = "alphasoftpy@gmail.com"

    @property
    def allowed_origins_list(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()