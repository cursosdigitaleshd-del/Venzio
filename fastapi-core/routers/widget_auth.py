from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from auth import create_widget_token
from database import get_db
from models import WidgetSite, User, Voice

router = APIRouter(tags=["Widget Auth"])


@router.get("/widget/auth")
async def widget_auth(site_id: str, request: Request, db: Session = Depends(get_db)):
    """
    Capa 1 — Emite un JWT temporal de 5 min para el widget embebido.

    Validaciones:
    1. site_id existe y está activo en la BD
    2. Origin del request coincide exactamente con domain_allowed del site

    Retorna:
    - token: JWT temporal
    - voice_id: ID de la voz activa del usuario
    - agent_name: Nombre del agente (usuario o "Agente Venzio")
    """
    # 1. Buscar site
    site = db.query(WidgetSite).filter(
        WidgetSite.site_id == site_id,
        WidgetSite.is_active == True,
    ).first()

    if not site:
        raise HTTPException(status_code=403, detail="site_id inválido o inactivo")

    # 2. Validar Origin / Same-origin
    origin = request.headers.get("origin") or request.headers.get("referer")
    host = request.url.hostname.lower()

    # 1️⃣ Same-origin permitido (sin Origin header)
    if not origin:
        if host in ["venzio.online", "www.venzio.online", "localhost", "127.0.0.1"]:
            pass  # Permitido
        else:
            raise HTTPException(status_code=403, detail="Origin header requerido para dominios externos")

    # 2️⃣ Cross-origin → validar contra dominios del site
    else:
        if origin:
            host = urlparse(origin).hostname
        else:
            host = None

        if not host:
            raise HTTPException(status_code=401, detail="Domain not allowed")

        allowed = (
            host.endswith(site.domain_allowed)
            or host.endswith("venzio.online")
        )

        if not allowed:
            raise HTTPException(status_code=401, detail="Domain not allowed")

    # 3. Obtener usuario
    user = db.get(User, site.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario no encontrado o inactivo")

    # 4. Obtener voz activa (primera voz activa como default)
    voice = db.query(Voice).filter(Voice.is_active == True).first()
    if not voice:
        raise HTTPException(status_code=500, detail="No hay voces activas disponibles")

    # 5. Determinar nombre del agente
    agent_name = user.full_name or user.company_name or "Agente Venzio"

    # 6. Generar JWT temporal (5 min, type="widget")
    token = create_widget_token(site_id=site.site_id, user_id=site.user_id)

    return {
        "token": token,
        "voice_id": voice.id,
        "agent_name": agent_name,
        "expires_in": 300,  # 5 minutos en segundos
    }
