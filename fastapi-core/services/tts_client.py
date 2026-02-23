import httpx
from loguru import logger
from config import settings


async def synthesize(text: str, voice_model_file: str) -> bytes:
    """
    Envía texto al microservicio TTS y devuelve los bytes de audio WAV.
    Args:
        text: texto a sintetizar
        voice_model_file: nombre del archivo .onnx de la voz a usar
    Returns:
        bytes de audio WAV
    """
    url = f"{settings.tts_service_url}/synthesize"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            params = {"text": text, "voice": voice_model_file}
            response = await client.get(url, params=params)
            response.raise_for_status()
            logger.debug(f"TTS sintetizó {len(response.content)} bytes para: '{text[:60]}...'")
            return response.content
    except httpx.ConnectError:
        logger.error(f"No se puede conectar al servicio TTS: {url}")
        raise RuntimeError("Servicio TTS no disponible")
    except httpx.HTTPStatusError as e:
        logger.error(f"TTS error {e.response.status_code}: {e.response.text}")
        raise RuntimeError(f"Error en TTS: {e.response.text}")
    except Exception as e:
        logger.error(f"Error inesperado en TTS client: {e}")
        raise
