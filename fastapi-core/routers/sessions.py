import json
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlalchemy.orm import Session

from auth import decode_token
from concurrency import session_manager
from database import get_db
from models import VoiceSession, Voice
from services import llm, stt_client, tts_client

router = APIRouter(tags=["Sesiones de Voz"])


@router.websocket("/ws/voice/{voice_id}")
async def voice_session(
    websocket: WebSocket,
    voice_id: int,
    authorization: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Pipeline WebSocket de voz:
    Cliente → (audio bytes) → STT → GPT-4o mini → TTS → (audio bytes) → Cliente

    Protocolo de mensajes:
    - Cliente envía: bytes de audio (WAV/WebM) para transcribir
    - Cliente puede enviar: JSON {"type": "end_session"} para terminar
    - Server responde: {"type": "transcript", "text": "..."} tras STT
    - Server responde: {"type": "reply_text", "text": "..."} con texto del LLM
    - Server responde: bytes de audio con la respuesta TTS
    - Server responde: {"type": "error", "message": "..."} en caso de error
    """
    await websocket.accept()

    # Parsear usuario opcional desde header Authorization
    user = None
    master_prompt = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]  # Remove "Bearer "
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                user = db.get(User, int(user_id))
                if user and user.is_active:
                    # Verificar suscripción activa
                    now = datetime.now(timezone.utc)
                    if user.subscription_end_date and user.subscription_end_date.replace(tzinfo=timezone.utc) > now:
                        master_prompt = user.master_prompt
                        db_session.user_id = user.id
                    else:
                        await websocket.send_text(json.dumps({"type": "error", "message": "Suscripción expirada. Contacte soporte."}))
                        await websocket.close()
                        return
                else:
                    user = None
        except Exception:
            pass  # Invalid token, continue as anonymous

    # Buscar voz en DB
    voice = db.get(Voice, voice_id)
    if not voice or not voice.is_active:
        await websocket.send_text(json.dumps({"type": "error", "message": "Voz no disponible"}))
        await websocket.close()
        return

    # Verificar límite de sesiones concurrentes
    session_token = secrets.token_hex(16)
    acquired = await session_manager.acquire(session_token)
    if not acquired:
        await websocket.send_text(
            json.dumps({"type": "error", "message": "Servidor ocupado. Intente en unos momentos."})
        )
        await websocket.close()
        return

    # Registrar sesión en DB
    db_session = VoiceSession(
        session_token=session_token,
        voice_id=voice_id,
        status="active",
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)

    # Historial de conversación para el LLM
    conversation_history: list[dict] = []
    full_transcript_parts: list[str] = []

    logger.info(f"Sesión de voz iniciada: {session_token} | Voz: {voice.name}")

    try:
        await websocket.send_text(
            json.dumps({
                "type": "session_ready",
                "session_token": session_token,
                "voice": voice.name,
            })
        )

        while True:
            # Recibir mensaje del cliente
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                break

            # Comando de texto (control)
            if "text" in message:
                data = json.loads(message["text"])
                if data.get("type") == "end_session":
                    break
                continue

            # Audio bytes – pipeline STT → LLM → TTS
            audio_bytes = message.get("bytes")
            if not audio_bytes:
                continue

            try:
                # 1. STT – Transcripción
                user_text = await stt_client.transcribe(audio_bytes)
                if not user_text:
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": "No se detectó audio claro"})
                    )
                    continue

                full_transcript_parts.append(f"Usuario: {user_text}")
                await websocket.send_text(
                    json.dumps({"type": "transcript", "text": user_text})
                )

                # 2. LLM – Respuesta
                conversation_history.append({"role": "user", "content": user_text})
                reply_text = await llm.chat_completion(conversation_history, system_prompt=master_prompt)
                conversation_history.append({"role": "assistant", "content": reply_text})
                full_transcript_parts.append(f"Agente: {reply_text}")

                await websocket.send_text(
                    json.dumps({"type": "reply_text", "text": reply_text})
                )

                # 3. TTS – Síntesis de voz
                audio_response = await tts_client.synthesize(reply_text, voice.model_file)
                await websocket.send_bytes(audio_response)

            except RuntimeError as e:
                await websocket.send_text(
                    json.dumps({"type": "error", "message": str(e)})
                )

    except WebSocketDisconnect:
        logger.info(f"Cliente desconectó: {session_token}")
    except Exception as e:
        logger.error(f"Error en sesión {session_token}: {e}")
    finally:
        # Cerrar sesión y guardar datos
        await session_manager.release(session_token)
        ended_at = datetime.now(timezone.utc)
        duration = int((ended_at - db_session.started_at.replace(tzinfo=timezone.utc)).total_seconds())

        db_session.status = "ended"
        db_session.ended_at = ended_at
        db_session.duration_seconds = duration
        db_session.transcript = "\n".join(full_transcript_parts)

        # Generar resumen si hay conversación
        if full_transcript_parts:
            try:
                db_session.summary = await llm.generate_summary(db_session.transcript)
            except Exception:
                pass

        db.commit()
        logger.info(f"Sesión finalizada: {session_token} | Duración: {duration}s")
