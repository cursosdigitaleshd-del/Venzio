import json
import secrets
from datetime import datetime, timezone
import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from auth import decode_token
from concurrency import session_manager
from database import get_db
from models import Voice, VoiceSession, User
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
    WebSocket público simplificado para el widget.
    
    Flujo:
    1. Cliente se conecta y recibe session_ready
    2. Cliente envía audio como bytes cuando el usuario habla
    3. Backend procesa: STT → LLM → TTS
    4. Backend envía transcripción, texto de respuesta y audio TTS
    5. Cliente reproduce y vuelve a escuchar
    """
    await websocket.accept()
    print(f"[WebSocket] Nueva conexión - Voice ID: {voice_id}")

    # ── Auth opcional ──────────────────────────────────────────────────────────
    user = None
    master_prompt = None
    
    if token:
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                user = db.get(User, int(user_id))
                if user and user.is_active:
                    now = datetime.now(timezone.utc)
                    has_active_subscription = (
                        user.subscription_end_date 
                        and user.subscription_end_date.replace(tzinfo=timezone.utc) > now
                    )
                    if has_active_subscription or user.is_admin:
                        master_prompt = user.master_prompt
                        print(f"[WebSocket] Usuario autenticado: {user.email}")
                    else:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Suscripción expirada. Contacte soporte."
                        }))
                        await websocket.close()
                        return
                else:
                    user = None
        except Exception as e:
            print(f"[WebSocket] Error validando token: {e}")
            # Continue as anonymous

    # ── Validar voz ────────────────────────────────────────────────────────────
    voice = db.get(Voice, voice_id)
    if not voice or not voice.is_active:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Voz no disponible"
        }))
        await websocket.close()
        return

    # ── Control de concurrencia ────────────────────────────────────────────────
    session_token = secrets.token_hex(16)
    acquired = await session_manager.acquire(session_token)
    
    if not acquired:
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "Servidor ocupado. Intente en unos momentos."
        }))
        await websocket.close()
        return

    # ── Registrar sesión ───────────────────────────────────────────────────────
    db_session = VoiceSession(
        session_token=session_token,
        voice_id=voice_id,
        user_id=user.id if user else None,
        status="active",
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    
    print(f"[WebSocket] Sesión creada: {session_token}")

    # ── Estado de la conversación ──────────────────────────────────────────────
    conversation_history: list[dict] = []
    full_transcript_parts: list[str] = []
    
    # Agregar master_prompt si existe
    if master_prompt:
        conversation_history.append({
            "role": "system",
            "content": master_prompt
        })

    try:
        # Confirmar sesión lista
        await websocket.send_text(json.dumps({
            "type": "session_ready",
            "session_token": session_token,
            "voice": voice.name,
        }))
        print(f"[WebSocket] session_ready enviado")

        # ── Loop principal ─────────────────────────────────────────────────────
        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                print(f"[WebSocket] Cliente desconectado: {session_token}")
                break
            except Exception as e:
                print(f"[WebSocket] Error recibiendo mensaje: {e}")
                break

            # ── Manejo de comandos de texto ────────────────────────────────────
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                    
                    if data.get("type") == "end_session":
                        print(f"[WebSocket] end_session recibido")
                        break
                        
                    # Ignorar otros comandos por ahora
                    print(f"[WebSocket] Comando recibido: {data.get('type')}")
                    
                except json.JSONDecodeError:
                    print(f"[WebSocket] JSON inválido recibido")
                    
                continue

            # ── Procesamiento de audio ─────────────────────────────────────────
            audio_bytes = message.get("bytes")
            if not audio_bytes:
                continue

            print(f"[WebSocket] Audio recibido: {len(audio_bytes)} bytes")

            try:
                # ── 1. Transcripción (STT) ─────────────────────────────────────
                print(f"[WebSocket] Iniciando STT...")
                user_text = await stt_client.transcribe(audio_bytes)
                
                if not user_text or len(user_text.strip()) < 2:
                    print(f"[WebSocket] Audio sin contenido claro")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "No se detectó audio claro"
                    }))
                    continue

                print(f"[WebSocket] STT resultado: {user_text}")
                
                # Guardar transcripción
                full_transcript_parts.append(f"Usuario: {user_text}")
                
                # Enviar transcripción al cliente
                await websocket.send_text(json.dumps({
                    "type": "final_transcript",
                    "text": user_text
                }))

                # ── 2. Generar respuesta (LLM) ─────────────────────────────────
                print(f"[WebSocket] Iniciando LLM...")
                conversation_history.append({
                    "role": "user",
                    "content": user_text
                })

                reply_text = await llm.chat_completion(
                    conversation_history,
                    master_prompt=master_prompt
                )
                
                print(f"[WebSocket] LLM resultado: {reply_text[:100]}...")
                
                # Guardar respuesta
                conversation_history.append({
                    "role": "assistant",
                    "content": reply_text
                })
                full_transcript_parts.append(f"Agente: {reply_text}")

                # Enviar texto de respuesta
                await websocket.send_text(json.dumps({
                    "type": "reply_text",
                    "text": reply_text
                }))

                # ── 3. Sintetizar audio (TTS) ──────────────────────────────────
                print(f"[WebSocket] Iniciando TTS...")
                
                try:
                    audio_response = await tts_client.synthesize(
                        text=reply_text,
                        voice_model=voice.model_file
                    )
                    
                    print(f"[WebSocket] TTS generado: {len(audio_response)} bytes")
                    
                    # Enviar audio al cliente
                    await websocket.send_bytes(audio_response)
                    print(f"[WebSocket] Audio TTS enviado")
                    
                except Exception as e:
                    print(f"[WebSocket] Error en TTS: {e}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Error generando audio de respuesta"
                    }))

            except Exception as e:
                print(f"[WebSocket] Error procesando audio: {e}")
                import traceback
                traceback.print_exc()
                
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Error procesando audio: {str(e)}"
                }))

    except WebSocketDisconnect:
        print(f"[WebSocket] Desconexión durante procesamiento: {session_token}")
        
    except Exception as e:
        print(f"[WebSocket] Error crítico en sesión {session_token}: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        # ── Limpieza y cierre ──────────────────────────────────────────────────
        print(f"[WebSocket] Cerrando sesión: {session_token}")
        
        # Liberar slot de concurrencia
        await session_manager.release(session_token)
        
        # Actualizar registro en DB
        ended_at = datetime.now(timezone.utc)
        started_at = db_session.started_at.replace(tzinfo=timezone.utc)
        duration = int((ended_at - started_at).total_seconds())

        db_session.status = "ended"
        db_session.ended_at = ended_at
        db_session.duration_seconds = duration
        db_session.transcript = "\n".join(full_transcript_parts)

        # Generar resumen si hay conversación
        if len(full_transcript_parts) > 2:  # Más de un intercambio
            try:
                print(f"[WebSocket] Generando resumen...")
                db_session.summary = await llm.generate_summary(db_session.transcript)
            except Exception as e:
                print(f"[WebSocket] Error generando resumen: {e}")
                db_session.summary = None

        db.commit()
        print(f"[WebSocket] Sesión guardada - Duración: {duration}s")
        
        # Cerrar WebSocket si aún está abierto
        try:
            await websocket.close()
        except:
            pass