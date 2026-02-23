import asyncio
from typing import Dict, Set
from loguru import logger
from config import settings


class SessionManager:
    """
    Gestiona las sesiones de voz activas en memoria.
    Usa asyncio.Lock para thread safety.
    No persiste en DB – solo estado en memoria.
    """

    def __init__(self):
        self._lock = asyncio.Lock()
        self._active: Dict[str, dict] = {}  # session_token -> metadata

    async def acquire(self, session_token: str, user_id: int | None = None) -> bool:
        """
        Intenta registrar una nueva sesión activa.
        Returns True si se adquirió, False si se alcanzó el límite global.
        """
        async with self._lock:
            if len(self._active) >= settings.max_global_sessions:
                logger.warning(
                    f"Límite global de sesiones alcanzado ({settings.max_global_sessions}). "
                    f"Rechazando sesión {session_token}"
                )
                return False
            self._active[session_token] = {
                "user_id": user_id,
                "session_token": session_token,
            }
            logger.info(
                f"Sesión adquirida: {session_token} | "
                f"Activas: {len(self._active)}/{settings.max_global_sessions}"
            )
            return True

    async def release(self, session_token: str) -> None:
        """Libera una sesión activa."""
        async with self._lock:
            if session_token in self._active:
                del self._active[session_token]
                logger.info(
                    f"Sesión liberada: {session_token} | "
                    f"Activas restantes: {len(self._active)}"
                )

    def count(self) -> int:
        """Devuelve el número de sesiones activas (sin lock, solo lectura)."""
        return len(self._active)

    def list_active(self) -> list:
        """Devuelve lista de sesiones activas para el admin panel."""
        return list(self._active.values())

    @property
    def max_sessions(self) -> int:
        return settings.max_global_sessions


# Singleton global
session_manager = SessionManager()
