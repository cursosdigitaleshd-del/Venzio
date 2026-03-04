import io
import os
import numpy as np
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
            cpu_threads=4,
            download_root=model_path,
        )
        self.language = settings.whisper_language  # "es"
        self._initialized = True
        logger.info(f"✅ Whisper listo | modelo={model_name} | idioma={self.language}")

    def _convert_to_wav(self, audio_bytes: bytes) -> np.ndarray:
        """
        Convierte audio bytes a numpy array usando pydub.
        Formato: mono, 16000Hz, float32 normalizado.
        """
        try:
            # Crear AudioSegment desde bytes - ffmpeg auto-detecta formato
            audio = AudioSegment.from_file(io.BytesIO(audio_bytes))
            audio = audio.set_frame_rate(16000).set_channels(1)

            samples = np.array(audio.get_array_of_samples())

            if audio.sample_width == 2:
                samples = samples.astype(np.float32) / 32768.0
            elif audio.sample_width == 4:
                samples = samples.astype(np.float32) / 2147483648.0
            else:
                samples = samples.astype(np.float32)

            return np.ascontiguousarray(samples)

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

        # Convertir a numpy array usando pydub
        try:
            samples = self._convert_to_wav(audio_bytes)
            logger.debug(f"Conversión a numpy array exitosa: {len(samples)} samples")
        except Exception as e:
            logger.error(f"Error procesando audio: {e}")
            raise RuntimeError(f"Audio inválido o corrupto: {e}")

        # Transcribir directamente desde numpy array
        segments, info = self.model.transcribe(
            samples,
            language=self.language,
            beam_size=1,
            vad_filter=True,           # Filtra silencios
            vad_parameters={"min_silence_duration_ms": 200},
        )
        text_parts = [seg.text.strip() for seg in segments]
        result = " ".join(text_parts).strip()
        logger.debug(f"STT transcribió {info.duration:.1f}s → '{result[:100]}'")
        return result


# Singleton global
transcriber = WhisperTranscriber()
