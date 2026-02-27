from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models import Voice

router = APIRouter(tags=["Public REST"])


# ── Schemas ───────────────────────────────────────────────────────────────────
class VoicePublicOut(BaseModel):
    id: int
    name: str
    language: str
    model_config = {"from_attributes": True}


# ── Public Voices ─────────────────────────────────────────────────────────────
@router.get("/voices", response_model=list[VoicePublicOut])
def get_public_voices(
    db: Session = Depends(get_db),
):
    """
    Endpoint público para el widget - solo devuelve voces activas.
    No requiere autenticación para que el widget embebible funcione.
    """
    return db.query(Voice).filter(Voice.is_active == True).all()