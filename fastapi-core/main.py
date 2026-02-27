import sys
import os
from contextlib import asynccontextmanager
from loguru import logger

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(__file__))

from config import settings
from database import init_db, SessionLocal
from models import User, Plan, Voice
from auth import hash_password

# ── Routers ───────────────────────────────────────────────────────────────────
from routers.auth import router as auth_router
from routers.sessions import router as sessions_router
from routers.admin import router as admin_router
from routers.plans import router as plans_router
from routers.voices import router as voices_router
from routers.webhook import router as webhook_router
from routers.users import router as users_router
from routers.contact import router as contact_router


# ── Logging ───────────────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | {message}",
    level="INFO",
)
logger.add(
    "logs/venzio.log",
    rotation="10 MB",
    retention="7 days",
    level="DEBUG",
)


# ── DB Seed ───────────────────────────────────────────────────────────────────
def seed_database():
    """
    Inserta/actualiza datos iniciales en la DB.
    Cada sección tiene su propio commit para ser 100% idempotente.
    - Siempre actualiza la contraseña del admin con el valor de .env
    - Siempre crea la voz por defecto si no existe
    """
    db = SessionLocal()

    # ── Planes por defecto ──────────────────────────────────────────────────
    try:
        default_plans = [
            ("Gratuito", 2, 30, 0.0),
            ("Básico", 5, 120, 29.0),
            ("Pro", 20, 600, 99.0),
        ]
        added = 0
        for name, max_s, max_m, price in default_plans:
            if not db.query(Plan).filter(Plan.name == name).first():
                db.add(Plan(name=name, max_sessions=max_s, max_minutes=max_m, price=price))
                added += 1
        if added:
            db.commit()
            logger.info(f"Planes por defecto creados: {added}")
        else:
            logger.info("Planes ya existentes – sin cambios")
    except Exception as e:
        logger.error(f"Error creando planes: {e}")
        db.rollback()

    # ── Admin user ────────────────────────────────────────────────────────────
    try:
        admin = db.query(User).filter(User.email == settings.admin_email).first()
        if not admin:
            current_admin = db.query(User).filter(User.is_admin == True).first()
            if current_admin:
                current_admin.email = settings.admin_email
                current_admin.hashed_password = hash_password(settings.admin_password)
                logger.info(f"Admin actualizado → {settings.admin_email}")
            else:
                db.add(User(
                    email=settings.admin_email,
                    hashed_password=hash_password(settings.admin_password),
                    full_name="Administrador",
                    is_admin=True,
                    is_active=True,
                ))
                logger.info(f"Admin creado: {settings.admin_email}")
        else:
            admin.hashed_password = hash_password(settings.admin_password)
            admin.is_admin = True
            admin.is_active = True
            logger.info(f"Admin sincronizado: {settings.admin_email}")
        db.commit()
    except Exception as e:
        logger.error(f"Error en admin seed: {e}")
        db.rollback()

    # ── Voz por defecto ───────────────────────────────────────────────────────
    try:
        existing_voice = db.query(Voice).filter(
            Voice.model_file == settings.default_voice_file
        ).first()
        if not existing_voice:
            db.add(Voice(
                name=settings.default_voice_name,
                language="es",
                model_file=settings.default_voice_file,
                description="Voz masculina en español de España – calidad media",
                is_active=True,
            ))
            db.commit()
            logger.info(f"Voz por defecto creada: {settings.default_voice_name}")
        else:
            logger.info(f"Voz ya existente: {existing_voice.name} | activa={existing_voice.is_active}")
    except Exception as e:
        logger.error(f"Error en voice seed: {e}")
        db.rollback()

    db.close()
    logger.success("✅ Seed completado")



# ── App Lifespan ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Iniciando Venzio Voice Agent...")
    os.makedirs("logs", exist_ok=True)
    os.makedirs("data", exist_ok=True)
    init_db()
    seed_database()
    logger.info(f"✅ DB lista | Max sesiones: {settings.max_global_sessions}")
    yield
    logger.info("🛑 Apagando servidor...")


# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Venzio – Voice Sales Agent",
    description="Plataforma SaaS de agente vendedor por voz con STT, TTS y GPT-4o mini",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(plans_router, prefix="/api")
app.include_router(voices_router, prefix="/api")
app.include_router(webhook_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(contact_router, prefix="/api")


@app.get("/admin/", tags=["Admin"])
def admin_redirect():
    return RedirectResponse(url="/admin/index.html")


@app.get("/health", tags=["Sistema"])
def health_check():
    return {
        "status": "ok",
        "service": "venzio-core",
        "version": "1.0.0",
    }
