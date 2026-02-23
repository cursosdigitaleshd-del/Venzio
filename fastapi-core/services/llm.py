from typing import List, Optional
from openai import AsyncOpenAI
from loguru import logger
from config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)

# System prompt base para el agente vendedor
BASE_SYSTEM_PROMPT = """Eres un agente de ventas profesional, amigable y eficiente que habla por teléfono.
Tu objetivo es entender las necesidades del cliente, presentar los productos/servicios de forma clara,
resolver dudas y guiar hacia el cierre de venta.
Responde siempre en español, de forma natural y conversacional.
Sé conciso (máximo 2-3 oraciones por respuesta) porque el usuario está escuchando por audio.
No uses listas, puntos o formato markdown – solo texto natural para ser sintetizado en voz."""


async def chat_completion(
    messages: List[dict],
    system_prompt: Optional[str] = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> str:
    """
    Llama a GPT-4o mini con el historial de mensajes y devuelve la respuesta.
    Args:
        messages: lista de {"role": "user"|"assistant", "content": "..."}
        system_prompt: prompt de sistema personalizado (opcional)
        max_tokens: límite de tokens (usa config por defecto)
        temperature: temperatura (usa config por defecto)
    Returns:
        string con la respuesta del LLM
    """
    system = system_prompt or BASE_SYSTEM_PROMPT
    full_messages = [{"role": "system", "content": system}] + messages

    try:
        response = await client.chat.completions.create(
            model=settings.llm_model,
            messages=full_messages,
            max_tokens=max_tokens or settings.llm_max_tokens,
            temperature=temperature if temperature is not None else settings.llm_temperature,
            timeout=settings.llm_timeout,
        )
        reply = response.choices[0].message.content or ""
        logger.debug(f"LLM reply ({len(reply)} chars): '{reply[:100]}...'")
        return reply.strip()
    except Exception as e:
        logger.error(f"Error en LLM: {e}")
        raise RuntimeError(f"Error al comunicarse con el LLM: {e}") from e


async def generate_summary(transcript: str) -> str:
    """Genera un resumen ejecutivo de la conversación para enviar vía webhook."""
    messages = [
        {
            "role": "user",
            "content": (
                f"Resume esta conversación de ventas en 3-5 puntos clave. "
                f"Incluye: intención del cliente, producto de interés, objeciones y resultado.\n\n"
                f"TRANSCRIPCIÓN:\n{transcript}"
            ),
        }
    ]
    return await chat_completion(
        messages,
        system_prompt="Eres un analista de ventas. Responde en español con bullet points simples.",
        max_tokens=300,
        temperature=0.3,
    )
