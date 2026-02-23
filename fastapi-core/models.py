from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey,
    Integer, String, Text, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    max_sessions: Mapped[int] = mapped_column(Integer, default=5)
    max_minutes: Mapped[int] = mapped_column(Integer, default=60)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    users: Mapped[list["User"]] = relationship("User", back_populates="plan")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    plan_id: Mapped[Optional[int]] = mapped_column(ForeignKey("plans.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    plan: Mapped[Optional["Plan"]] = relationship("Plan", back_populates="users")
    sessions: Mapped[list["VoiceSession"]] = relationship("VoiceSession", back_populates="user")
    usage_logs: Mapped[list["UsageLog"]] = relationship("UsageLog", back_populates="user")


class Voice(Base):
    """Voces TTS disponibles. El admin puede agregar/quitar desde el panel."""
    __tablename__ = "voices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="es")
    model_file: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sessions: Mapped[list["VoiceSession"]] = relationship("VoiceSession", back_populates="voice")


class VoiceSession(Base):
    __tablename__ = "voice_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    voice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("voices.id"), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|ended|error
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[Optional["User"]] = relationship("User", back_populates="sessions")
    voice: Mapped[Optional["Voice"]] = relationship("Voice", back_populates="sessions")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    minutes_used: Mapped[float] = mapped_column(Float, default=0.0)
    sessions_count: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship("User", back_populates="usage_logs")
