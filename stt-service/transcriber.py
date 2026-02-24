import io
import os
import tempfile
from faster_whisper import WhisperModel
from loguru import logger
from pydub import AudioSegment
from config import settings


class WhisperTranscriber:
    """Singleton wrapper around faster-whisper. Loaded once at startup."""

    _instance: "WhisperTranscriber | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        model_name = settings.whisper_model
        model_path = os.environ.get("WHISPER_MODEL_PATH", "models")
        logger.info(f"Cargando modelo Whisper '{model_name}' desde '{model_path}'...")
        self.model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8",           # Óptimo para CPU
            download_root=model_path,
        )
        self.language = settings.whisper_language  # "es"
        self._initialized = True
        logger.info(f"✅ Whisper listo | modelo={model_name} | idioma={self.language}")

    def _convert_to_wav(self, audio_bytes: bytes) -> bytes:
        """
        Convierte audio bytes a formato WAV usando pydub.
        Deja que ffmpeg auto-detecte el formato.
        """
        try:
            # Crear AudioSegment desde bytes - ffmpeg auto-detecta formato
            audio = AudioSegment.from_file(io.BytesIO(audio_bytes))

            # Exportar a WAV
            wav_buffer = io.BytesIO()
            audio.export(wav_buffer, format="wav")
            return wav_buffer.getvalue()

        except Exception as e:
            logger.error(f"Error procesando audio con ffmpeg: {e}")
            raise RuntimeError(f"Audio inválido o corrupto: {e}")

    def transcribe(self, audio_bytes: bytes) -> str:
        """
        Transcribe audio bytes a texto en español.
        Args:
            audio_bytes: bytes de audio (WAV, WebM, OGG, etc.)
        Returns:
            texto transcripto (string)
        """
        logger.debug(f"Audio recibido: tamaño={len(audio_bytes)} bytes")

        # Convertir a WAV usando pydub (ffmpeg auto-detecta formato)
        try:
            audio_bytes = self._convert_to_wav(audio_bytes)
            logger.debug(f"Conversión a WAV exitosa: nuevo tamaño={len(audio_bytes)} bytes")
        except Exception as e:
            logger.error(f"Error procesando audio: {e}")
            raise RuntimeError(f"Audio inválido o corrupto: {e}")

        # Escribir a archivo temporal para faster-whisper
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            segments, info = self.model.transcribe(
                tmp_path,
                language=self.language,
                beam_size=5,
                vad_filter=True,           # Filtra silencios
                vad_parameters={"min_silence_duration_ms": 500},
            )
            text_parts = [seg.text.strip() for seg in segments]
            result = " ".join(text_parts).strip()
            logger.debug(f"STT transcribió {info.duration:.1f}s → '{result[:100]}'")
            return result
        finally:
            os.unlink(tmp_path)


# Singleton global
transcriber = WhisperTranscriber()
