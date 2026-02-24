from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from datetime import datetime, timedelta
from auth import get_current_admin
from concurrency import session_manager
from database import get_db
from models import Payment, Plan, User, Voice, VoiceSession, UsageLog

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Schemas ───────────────────────────────────────────────────────────────────
class UserOut(BaseModel):
    id: int
    email: str
    full_name: str | None
    phone: str | None
    company_name: str | None
    website: str | None
    master_prompt: str | None
    plan_id: int | None
    subscription_end_date: datetime | None
    is_active: bool
    is_admin: bool
    model_config = {"from_attributes": True}


class VoiceCreate(BaseModel):
    name: str
    language: str = "es"
    model_file: str
    description: str | None = None


class VoiceUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    description: str | None = None


class VoiceOut(BaseModel):
    id: int
    name: str
    language: str
    model_file: str
    description: str | None
    is_active: bool
    model_config = {"from_attributes": True}


class UpdateUserPlan(BaseModel):
    plan_id: int | None


class RegisterPayment(BaseModel):
    amount: float
    days_added: int
    description: str
    plan_id: int | None = None


class UpdateUserPrompt(BaseModel):
    master_prompt: str


class PaymentOut(BaseModel):
    id: int
    user_id: int
    amount: float
    days_added: int
    payment_date: datetime
    description: str
    plan_id: int | None
    created_by: int
    model_config = {"from_attributes": True}


# ── Stats ─────────────────────────────────────────────────────────────────────
@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    total_users = db.query(User).count()
    total_sessions = db.query(VoiceSession).count()
    active_count = session_manager.count()
    active_sessions = session_manager.list_active()
    return {
        "total_users": total_users,
        "total_sessions": total_sessions,
        "active_sessions_count": active_count,
        "max_sessions": session_manager.max_sessions,
        "active_sessions": active_sessions,
    }


# ── Users ─────────────────────────────────────────────────────────────────────
@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    return db.query(User).all()


@router.put("/users/{user_id}/plan")
def update_user_plan(
    user_id: int,
    payload: UpdateUserPlan,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if payload.plan_id is not None:
        plan = db.get(Plan, payload.plan_id)
        if not plan:
            raise HTTPException(status_code=404, detail="Plan no encontrado")
    user.plan_id = payload.plan_id
    db.commit()
    return {"ok": True}


@router.put("/users/{user_id}/toggle")
def toggle_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.is_active = not user.is_active
    db.commit()
    return {"ok": True, "is_active": user.is_active}


@router.put("/users/{user_id}/prompt")
def update_user_prompt(
    user_id: int,
    payload: UpdateUserPrompt,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.master_prompt = payload.master_prompt
    db.commit()
    return {"ok": True, "master_prompt": user.master_prompt}


# ── Voices ────────────────────────────────────────────────────────────────────
@router.get("/voices", response_model=list[VoiceOut])
def list_all_voices(
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    return db.query(Voice).all()


@router.post("/voices", response_model=VoiceOut, status_code=201)
def create_voice(
    payload: VoiceCreate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    if db.query(Voice).filter(Voice.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Ya existe una voz con ese nombre")
    voice = Voice(**payload.model_dump())
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice


@router.put("/voices/{voice_id}", response_model=VoiceOut)
def update_voice(
    voice_id: int,
    payload: VoiceUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    voice = db.get(Voice, voice_id)
    if not voice:
        raise HTTPException(status_code=404, detail="Voz no encontrada")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(voice, field, value)
    db.commit()
    db.refresh(voice)
    return voice


@router.delete("/voices/{voice_id}")
def delete_voice(
    voice_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    voice = db.get(Voice, voice_id)
    if not voice:
        raise HTTPException(status_code=404, detail="Voz no encontrada")
    db.delete(voice)
    db.commit()
    return {"ok": True}


# ── Payments ──────────────────────────────────────────────────────────────────
@router.post("/users/{user_id}/payments", response_model=PaymentOut, status_code=201)
def register_payment(
    user_id: int,
    payload: RegisterPayment,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Calcular nueva fecha de fin de suscripción
    current_end = user.subscription_end_date or datetime.now()
    new_end = current_end + timedelta(days=payload.days_added)

    # Crear registro de pago
    payment = Payment(
        user_id=user_id,
        amount=payload.amount,
        days_added=payload.days_added,
        description=payload.description,
        plan_id=payload.plan_id,
        created_by=admin.id,
    )
    db.add(payment)

    # Actualizar suscripción del usuario
    user.subscription_end_date = new_end
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/payments", response_model=list[PaymentOut])
def list_all_payments(
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    return db.query(Payment).order_by(Payment.payment_date.desc()).all()
