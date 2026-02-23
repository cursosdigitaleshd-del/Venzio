import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from loguru import logger

from synthesizer import synthesizer

logger.remove()
logger.add(sys.stdout, level="INFO", format="<green>{time:HH:mm:ss}</green> | <level>{level}</level> | {message}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🔊 TTS Service listo (Piper TTS / español)")
    yield
    logger.info("🛑 TTS Service detenido")


app = FastAPI(title="Venzio TTS Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "service": "tts", "engine": "piper"}


@app.get("/synthesize")
def synthesize(
    text: str,
    voice: str = "es_ES-davefx-medium.onnx",
):
    """
    Sintetiza el texto dado y devuelve audio WAV.
    - text: texto en español a sintetizar
    - voice: nombre del archivo .onnx (ej: es_ES-davefx-medium.onnx)
    """
    if not text.strip():
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío")

    try:
        audio_bytes = synthesizer.synthesize(text, voice)
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=response.wav"},
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error en síntesis: {e}")
        raise HTTPException(status_code=500, detail=f"Error en TTS: {str(e)}")
