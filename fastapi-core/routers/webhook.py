import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from loguru import logger

from auth import get_current_user
from models import User

router = APIRouter(prefix="/webhook", tags=["Webhooks"])


class WebhookPayload(BaseModel):
    webhook_url: str       # URL del webhook n8n
    session_token: str
    summary: str
    transcript: str | None = None
    phone_number: str | None = None


@router.post("/whatsapp")
async def send_to_whatsapp(
    payload: WebhookPayload,
    current_user: User = Depends(get_current_user),
):
    """
    Envía el resumen de la sesión al webhook de n8n para que lo reenvíe por WhatsApp.
    n8n maneja la integración con WhatsApp Cloud API / Twilio.
    """
    n8n_data = {
        "session_token": payload.session_token,
        "summary": payload.summary,
        "transcript": payload.transcript,
        "phone_number": payload.phone_number,
        "user_email": current_user.email,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(payload.webhook_url, json=n8n_data)
            response.raise_for_status()
            logger.info(
                f"Webhook enviado a n8n para sesión {payload.session_token} "
                f"| Status: {response.status_code}"
            )
            return {"ok": True, "n8n_status": response.status_code}
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="No se pudo conectar con el webhook de n8n")
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"n8n respondió con error {e.response.status_code}",
        )
