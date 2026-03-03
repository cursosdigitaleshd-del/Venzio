from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func

from auth import get_current_user
from database import get_db
from models import Payment, User, WidgetSite, UsageLog
from urllib.parse import urlparse

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
    master_prompt: str | None
    plan_id: int | None
    subscription_end_date: datetime | None
    site_id: str | None = None
    is_active: bool
    is_admin: bool
    plan_name: str | None
    plan_status: str
    plan_max_minutes: int
    usage_this_month: float
    renewal_date: datetime | None
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
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Buscar o crear WidgetSite para el usuario
    site = db.query(WidgetSite).filter_by(user_id=current_user.id, is_active=True).first()
    if not site:
        if current_user.is_admin:
            domain_allowed = "venzio.online"
        else:
            domain = current_user.website or "midominio.com"
            parsed = urlparse(domain).netloc.lower()
            if not parsed:
                parsed = domain.replace("http://", "").replace("https://", "").split("/")[0].lower()
            domain_allowed = parsed

        site = WidgetSite(
            user_id=current_user.id,
            site_id=WidgetSite.generate_site_id(),
            secret_key=WidgetSite.generate_secret_key(),
            domain_allowed=domain_allowed
        )
        db.add(site)
        try:
            db.commit()
            db.refresh(site)
        except Exception:
            db.rollback()
            site = None

    # Calcular consumo del mes
    now = datetime.utcnow()
    start_of_month = datetime(now.year, now.month, 1)
    usage_this_month = db.query(
        func.coalesce(func.sum(UsageLog.minutes_used), 0)
    ).filter(
        UsageLog.user_id == current_user.id,
        UsageLog.date >= start_of_month.strftime('%Y-%m-%d')
    ).scalar()

    # Datos del plan
    plan_name = current_user.plan.name if current_user.plan else None
    plan_max_minutes = current_user.plan.max_minutes if current_user.plan else 0
    renewal_date = current_user.subscription_end_date
    plan_status = "active" if current_user.is_active and current_user.plan else "inactive"

    user_dict = current_user.__dict__.copy()
    user_dict.pop('_sa_instance_state', None)

    user_dict['site_id'] = site.site_id if site else None
    user_dict['plan_name'] = plan_name
    user_dict['plan_status'] = plan_status
    user_dict['plan_max_minutes'] = plan_max_minutes
    user_dict['usage_this_month'] = usage_this_month
    user_dict['renewal_date'] = renewal_date

    return UserProfile.model_validate(user_dict)


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