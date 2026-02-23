from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Payment, User

router = APIRouter(prefix="/users", tags=["Usuarios"])


# ── Schemas ───────────────────────────────────────────────────────────────────
class UserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    company_name: str | None = None
    website: str | None = None


class UserProfile(BaseModel):
    id: int
    email: str
    full_name: str | None
    phone: str | None
    company_name: str | None
    website: str | None
    plan_id: int | None
    subscription_end_date: datetime | None
    is_active: bool
    is_admin: bool
    model_config = {"from_attributes": True}


class PaymentOut(BaseModel):
    id: int
    amount: float
    days_added: int
    payment_date: datetime
    description: str
    plan_id: int | None
    model_config = {"from_attributes": True}


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/me", response_model=UserProfile)
def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserProfile)
def update_my_profile(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/me/payments", response_model=list[PaymentOut])
def get_my_payments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Payment).filter(Payment.user_id == current_user.id).order_by(Payment.payment_date.desc()).all()