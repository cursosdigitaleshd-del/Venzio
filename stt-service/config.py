import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class STTSettings(BaseSettings):
    whisper_model: str = "base"
    whisper_language: str = "es"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = STTSettings()
