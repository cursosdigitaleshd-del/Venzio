from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from loguru import logger

from services.email import send_contact_email

router = APIRouter(prefix="/contact", tags=["Contacto"])


# ── Schemas ───────────────────────────────────────────────────────────────────
class ContactRequest(BaseModel):
    name: str
    email: EmailStr
    subject: str
    message: str


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.post("/")
async def send_contact_message(payload: ContactRequest):
    """
    Envía un mensaje de contacto por email.
    """
    try:
        success = await send_contact_email(
            name=payload.name,
            email=payload.email,
            subject=payload.subject,
            message=payload.message
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Error al enviar el mensaje. Inténtalo de nuevo."
            )

        return {"message": "Mensaje enviado exitosamente"}

    except Exception as e:
        logger.error(f"Error en endpoint de contacto: {e}")
        raise HTTPException(
            status_code=500,
            detail="Error interno del servidor"
        )