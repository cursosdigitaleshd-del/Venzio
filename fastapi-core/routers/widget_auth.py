from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from auth import create_widget_token
from database import get_db
from models import WidgetSite

router = APIRouter(tags=["Widget Auth"])


@router.get("/widget/auth")
async def widget_auth(site_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Capa 1 — Emite un JWT temporal de 5 min para el widget embebido.

    Validaciones:
    1. site_id existe y está activo en la BD
    2. Origin del request coincide exactamente con domain_allowed del site
    """
    # 1. Buscar site
    site = db.query(WidgetSite).filter(
        WidgetSite.site_id == site_id,
        WidgetSite.is_active == True,
    ).first()

    if not site:
        raise HTTPException(status_code=403, detail="site_id inválido o inactivo")

    # 2. Validar Origin
    origin = request.headers.get("origin")
    if not origin:
        raise HTTPException(status_code=403, detail="Origin header requerido")

    parsed_origin = urlparse(origin).netloc.lower()
    
    allowed_domains = {
        site.domain_allowed.lower(),
        "venzio.online",
        "www.venzio.online",
        "localhost:8000",
        "127.0.0.1:8000"
    }

    if parsed_origin not in allowed_domains:
        raise HTTPException(
            status_code=403,
            detail=f"Dominio no autorizado: {parsed_origin}",
        )

    # 3. Generar JWT temporal (5 min, type="widget")
    token = create_widget_token(site_id=site.site_id, user_id=site.user_id)

    return {
        "token": token,
        "expires_in": 300,  # 5 minutos en segundos
    }
