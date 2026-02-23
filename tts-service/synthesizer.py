import io
import os
import subprocess
import tempfile
from loguru import logger


class PiperSynthesizer:
    """
    Wrapper del binario `piper` para TTS.
    Piper debe estar instalado en el PATH (el Dockerfile lo instala).
    """

    def __init__(self):
        self.models_dir = os.environ.get("PIPER_MODELS_DIR", "models")
        self._check_piper()

    def _check_piper(self):
        try:
            result = subprocess.run(
                ["piper", "--version"],
                capture_output=True, text=True, timeout=10
            )
            logger.info(f"✅ Piper disponible: {result.stdout.strip() or result.stderr.strip()}")
        except FileNotFoundError:
            logger.error("❌ Piper no encontrado en PATH. Verifica la instalación en el Dockerfile.")
        except Exception as e:
            logger.warning(f"No se pudo verificar Piper: {e}")

    def synthesize(self, text: str, voice_model_file: str) -> bytes:
        """
        Sintetiza texto a audio WAV usando Piper.
        Args:
            text: texto en español para sintetizar
            voice_model_file: nombre del archivo .onnx de la voz (ej: es_ES-davefx-medium.onnx)
        Returns:
            bytes de audio WAV
        """
        model_path = os.path.join(self.models_dir, voice_model_file)
        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Modelo de voz no encontrado: {model_path}. "
                f"Descarga el archivo .onnx y colócalo en {self.models_dir}/"
            )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as out_file:
            out_path = out_file.name

        try:
            cmd = [
                "piper",
                "--model", model_path,
                "--output_file", out_path,
            ]
            result = subprocess.run(
                cmd,
                input=text,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(f"Error en Piper: {result.stderr}")

            with open(out_path, "rb") as f:
                audio_bytes = f.read()

            logger.debug(f"TTS sintetizó {len(text)} chars → {len(audio_bytes)} bytes WAV")
            return audio_bytes
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)


# Singleton global
synthesizer = PiperSynthesizer()
