import json
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException
from sqlalchemy.orm import Session

from auth import decode_widget_token
from concurrency import session_manager
from database import get_db
from models import Voice, VoiceSession, User, WidgetSite
from services import llm, stt_client, tts_client

router = APIRouter(tags=["Public WebSocket"])


# ── Public Voice WebSocket ────────────────────────────────────────────────────
@router.websocket("/ws/public/voice/{voice_id}")
async def public_voice_session(
    websocket: WebSocket,
    voice_id: int,
    token: str | None = None,
    db: Session = Depends(get_db),
):
    """
    WebSocket público para el widget.
    Capa 2 de seguridad: valida JWT tipo 'widget' + Origin antes de accept().
    Pipeline: Cliente → audio → STT → LLM → TTS → audio → Cliente
    """
    # ── CAPA 2: Validar antes de accept() ─────────────────────────────────────
    if not token:
        await websocket.close(code=1008, reason="Token requerido")
        return

    try:
        payload = decode_widget_token(token)  # valida firma, expiración y type='widget'
    except Exception:
        await websocket.close(code=1008, reason="Token inválido o expirado")
        return

    # Validar Origin también en el WS (segunda validación de dominio)
    origin = websocket.headers.get("origin", "")
    parsed_origin = urlparse(origin).netloc.lower()

    site = db.query(WidgetSite).filter(
        WidgetSite.site_id == payload["sid"],
        WidgetSite.is_active == True,
    ).first()
    
    allowed_domains = {
        site.domain_allowed.lower() if site else "",
        "venzio.online",
        "www.venzio.online",
        "localhost:8000",
        "127.0.0.1:8000"
    }

    if not site or parsed_origin not in allowed_domains:
        await websocket.close(code=1008, reason="Dominio no autorizado")
        return

    # Cargar master_prompt del usuario dueño del site
    owner = db.get(User, site.user_id)
    master_prompt = owner.master_prompt if owner and owner.is_active else None

    # Verificar suscripción activa del dueño del site
    if owner and not owner.is_admin:
        now = datetime.now(timezone.utc)
        has_active_sub = (
            owner.subscription_end_date
            and owner.subscription_end_date.replace(tzinfo=timezone.utc) > now
        )
        if not has_active_sub:
            await websocket.close(code=1008, reason="Suscripción del site expirada")
            return

        # Verificar límite de minutos (con protección contra None)
        if owner.plan and owner.plan.max_minutes and (owner.minutes_used or 0) >= owner.plan.max_minutes:
            await websocket.close(code=4002, reason="Límite mensual de minutos alcanzado")
            return

    # ── Ahora sí: aceptar la conexión ─────────────────────────────────────────
    await websocket.accept()

    # Buscar voz activa
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
        user_id=owner.id,
        status="active",
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)

    # Historial de conversación
    conversation_history: list[dict] = []
    full_transcript_parts: list[str] = []

    try:
        await websocket.send_text(
            json.dumps({
                "type": "session_ready",
                "session_token": session_token,
                "voice": voice.name,
            })
        )

        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                break

            # Comando de texto
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
                # 1. STT
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

                # 2. LLM — usar prompt del cliente si existe
                conversation_history.append({"role": "user", "content": user_text})
                system_prompt = llm.build_system_prompt(master_prompt)
                reply_text = await llm.chat_completion(
                    conversation_history,
                    system_prompt=system_prompt,
                )
                conversation_history.append({"role": "assistant", "content": reply_text})
                full_transcript_parts.append(f"Agente: {reply_text}")

                await websocket.send_text(
                    json.dumps({"type": "reply_text", "text": reply_text})
                )

                # 3. TTS
                audio_response = await tts_client.synthesize(reply_text, voice.model_file)
                await websocket.send_bytes(audio_response)

            except RuntimeError as e:
                await websocket.send_text(
                    json.dumps({"type": "error", "message": str(e)})
                )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error en sesión pública {session_token}: {e}")
    finally:
        # Cerrar sesión
        await session_manager.release(session_token)
        ended_at = datetime.now(timezone.utc)
        duration = int((ended_at - db_session.started_at.replace(tzinfo=timezone.utc)).total_seconds())

        db_session.status = "ended"
        db_session.ended_at = ended_at
        db_session.duration_seconds = duration
        db_session.transcript = "\n".join(full_transcript_parts)

        # Actualizar minutos usados del owner (con protección contra None)
        if owner and not owner.is_admin:
            owner.minutes_used = (owner.minutes_used or 0) + (duration / 60.0)

        # Generar resumen si hay conversación
        if full_transcript_parts:
            try:
                db_session.summary = await llm.generate_summary(db_session.transcript)
            except Exception:
                pass

        db.commit()
