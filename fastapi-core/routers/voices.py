from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Voice

router = APIRouter(prefix="/voices", tags=["Voces"])


class VoiceOut(BaseModel):
    id: int
    name: str
    language: str
    model_file: str
    description: str | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[VoiceOut])
def list_voices(db: Session = Depends(get_db)):
    """Lista todas las voces activas disponibles para el widget."""
    return db.query(Voice).filter(Voice.is_active == True).all()
