import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from loguru import logger

from transcriber import transcriber

# ── Logging ───────────────────────────────────────────────────────────────────
logger.remove()
logger.add(sys.stdout, level="INFO", format="<green>{time:HH:mm:ss}</green> | <level>{level}</level> | {message}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🎙 STT Service listo (faster-whisper / español)")
    yield
    logger.info("🛑 STT Service detenido")


app = FastAPI(title="Venzio STT Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "stt", "model": "whisper", "language": "es"}


@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Recibe un archivo de audio y devuelve la transcripción en español.
    Acepta: WAV, WebM, OGG, MP3.
    """
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Archivo de audio requerido")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío")

    try:
        text = transcriber.transcribe(audio_bytes)
        return {"text": text, "language": "es"}
    except Exception as e:
        logger.error(f"Error en transcripción: {e}")
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {str(e)}")
