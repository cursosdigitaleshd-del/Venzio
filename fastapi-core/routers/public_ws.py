import asyncio
import json
import secrets
import time
from collections import deque
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

    # Variables para STT streaming
    current_audio_buffer = {}
    utterance_partials = {}
    current_utterance_id = None
    stream_buffer = b""
    partial_tasks = deque()
    current_audio_size = 0
    last_partial_time = 0
    utterance_start = None
    last_audio_time = None

    MAX_AUDIO_BYTES = 5 * 1024 * 1024  # 5MB límite
    STREAM_THRESHOLD = 8000  # ~400ms de audio
    MAX_STREAM_BUFFER = 16000

    # Historial de conversación
    conversation_history: list[dict] = []
    full_transcript_parts: list[str] = []

    async def process_partial_stt(chunk, utterance_id, ws, tasks_set):
        """STT no bloqueante con cleanup automático"""
        try:
            partial = await asyncio.wait_for(
                stt_client.stream_partial(chunk),
                timeout=2.0
            )
            if partial and ws.client_state.name == "CONNECTED":
                try:
                    await ws.send_text(json.dumps({
                        "type": "partial_transcript",
                        "text": partial,
                        "id": utterance_id
                    }))
                except (RuntimeError, Exception) as e:
                    print(f"WebSocket send failed: {e}")
        except asyncio.TimeoutError:
            print("Partial STT timeout")
        except Exception as e:
            print(f"Partial STT failed: {e}")
        finally:
            tasks_set.discard(asyncio.current_task())

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

                if data.get("type") == "audio_start":
                    current_utterance_id = data.get("id", secrets.token_hex(8))
                    current_audio_buffer[current_utterance_id] = []
                    utterance_partials[current_utterance_id] = ""
                    stream_buffer = b""
                    current_audio_size = 0
                    utterance_start = time.time()
                    last_audio_time = time.time()

                elif data.get("type") == "audio_end":
                    if current_utterance_id and current_utterance_id in current_audio_buffer:
                        # STT final
                        audio_bytes = b"".join(current_audio_buffer[current_utterance_id])
                        final_text = await stt_client.transcribe(audio_bytes)

                        await websocket.send_text(json.dumps({
                            "type": "final_transcript",
                            "text": final_text,
                            "id": current_utterance_id
                        }))

                        # Procesar respuesta
                        if final_text:
                            full_transcript_parts.append(f"Usuario: {final_text}")
                            conversation_history.append({"role": "user", "content": final_text})

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

                            # TTS
                            audio_response = await tts_client.synthesize(reply_text, voice.model_file)
                            await websocket.send_bytes(audio_response)

                        # Cleanup
                        del current_audio_buffer[current_utterance_id]
                        del utterance_partials[current_utterance_id]
                        current_utterance_id = None
                        current_audio_size = 0
                        utterance_start = None
                        last_audio_time = None

                elif data.get("type") == "end_session":
                    break

                continue

            # Audio bytes
            elif "bytes" in message:
                chunk = message["bytes"]

                # Compatibilidad con widget v1.0 (blob único)
                if not current_utterance_id:
                    current_utterance_id = secrets.token_hex(8)
                    current_audio_buffer[current_utterance_id] = []
                    utterance_partials[current_utterance_id] = ""
                    stream_buffer = b""
                    current_audio_size = 0
                    utterance_start = time.time()
                    last_audio_time = time.time()
                last_audio_time = time.time()

                # Verificar límites de memoria
                current_audio_size += len(chunk)
                if current_audio_size > MAX_AUDIO_BYTES:
                    print(f"Audio buffer exceeded {MAX_AUDIO_BYTES} bytes")
                    current_audio_buffer[current_utterance_id].clear()
                    current_audio_size = 0
                    current_utterance_id = None
                    continue

                current_audio_buffer[current_utterance_id].append(chunk)

                # Compatibilidad widget v1.0: procesar blob único inmediatamente
                if len(current_audio_buffer[current_utterance_id]) == 1 and len(chunk) > 1000:
                    # Procesar blob único sin esperar audio_end
                    audio_bytes = chunk
                    print(f"Procesando blob único: {len(audio_bytes)} bytes, ID: {current_utterance_id}")

                    try:
                        final_text = await stt_client.transcribe(audio_bytes)

                        await websocket.send_text(json.dumps({
                            "type": "final_transcript",
                            "text": final_text,
                            "id": current_utterance_id
                        }))

                        # Procesar respuesta
                        if final_text:
                            full_transcript_parts.append(f"Usuario: {final_text}")
                            conversation_history.append({"role": "user", "content": final_text})

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

                            # TTS
                            audio_response = await tts_client.synthesize(reply_text, voice.model_file)
                            await websocket.send_bytes(audio_response)

                    except Exception as e:
                        print(f"Error procesando blob único: {e}")

                    # Cleanup
                    del current_audio_buffer[current_utterance_id]
                    del utterance_partials[current_utterance_id]
                    current_utterance_id = None
                    current_audio_size = 0
                    utterance_start = None
                    last_audio_time = None
                    continue

                # Buffer para streaming
                stream_buffer += chunk
                if len(stream_buffer) > MAX_STREAM_BUFFER:
                    stream_buffer = b""  # Reset si se desborda
                    continue

                # Streaming STT
                if len(stream_buffer) > STREAM_THRESHOLD:
                    current_time = time.time()
                    if current_time - last_partial_time > 0.2:  # Rate limiting
                        last_partial_time = current_time

                        # Control de concurrencia
                        if len(partial_tasks) > 3:
                            if partial_tasks:
                                oldest_task = partial_tasks.popleft()
                                oldest_task.cancel()
                                try:
                                    await oldest_task
                                except asyncio.CancelledError:
                                    pass

                        # Crear task no bloqueante
                        task = asyncio.create_task(
                            process_partial_stt(stream_buffer, current_utterance_id, websocket, partial_tasks)
                        )
                        partial_tasks.append(task)

                # Check timeout por inactividad
                current_time = time.time()
                if (current_utterance_id and last_audio_time and
                    (current_time - last_audio_time) > 5):  # 5s inactividad
                    print("Utterance inactivity timeout")
                    if current_utterance_id in current_audio_buffer:
                        del current_audio_buffer[current_utterance_id]
                    if current_utterance_id in utterance_partials:
                        del utterance_partials[current_utterance_id]
                    current_audio_size = 0
                    current_utterance_id = None
                    utterance_start = None
                    last_audio_time = None

    except WebSocketDisconnect:
        # Cancelar tasks pendientes
        for task in partial_tasks:
            task.cancel()
        try:
            await asyncio.gather(*partial_tasks, return_exceptions=True)
        except asyncio.CancelledError:
            pass
        partial_tasks.clear()
        current_audio_buffer.clear()
        utterance_partials.clear()
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
