import httpx
from loguru import logger
from config import settings


async def transcribe(audio_bytes: bytes, filename: str = "audio.wav") -> str:
    """
    Envía audio al microservicio STT y devuelve la transcripción.
    Args:
        audio_bytes: bytes de audio (WAV/WebM/OGG)
        filename: nombre de archivo para el multipart
    Returns:
        texto transcripto
    """
    url = f"{settings.stt_service_url}/transcribe"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            files = {"audio": (filename, audio_bytes, "audio/wav")}
            response = await client.post(url, files=files)
            response.raise_for_status()
            data = response.json()
            text = data.get("text", "").strip()
            logger.debug(f"STT result: '{text[:100]}...'")
            return text
    except httpx.ConnectError:
        logger.error(f"No se puede conectar al servicio STT: {url}")
        raise RuntimeError("Servicio STT no disponible")
    except httpx.HTTPStatusError as e:
        logger.error(f"STT error {e.response.status_code}: {e.response.text}")
        raise RuntimeError(f"Error en STT: {e.response.text}")
    except Exception as e:
        logger.error(f"Error inesperado en STT client: {e}")
        raise
