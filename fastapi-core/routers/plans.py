from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_admin
from database import get_db
from models import Plan

router = APIRouter(prefix="/plans", tags=["Planes"])


class PlanCreate(BaseModel):
    name: str
    max_sessions: int = 5
    max_minutes: int = 60
    price: float = 0.0


class PlanOut(BaseModel):
    id: int
    name: str
    max_sessions: int
    max_minutes: int
    price: float
    is_active: bool
    model_config = {"from_attributes": True}


@router.get("", response_model=list[PlanOut])
def list_plans(db: Session = Depends(get_db)):
    return db.query(Plan).filter(Plan.is_active == True).all()


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanCreate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    plan = Plan(**payload.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/{plan_id}")
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    plan.is_active = False
    db.commit()
    return {"ok": True}
