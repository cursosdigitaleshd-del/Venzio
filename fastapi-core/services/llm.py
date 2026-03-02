from typing import List, Optional
from openai import AsyncOpenAI
from loguru import logger
from config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)

# Instrucciones base que SIEMPRE se aplican — no negociables
BASE_INSTRUCTIONS = """Eres un agente de ventas virtual que habla por teléfono en representación de un negocio específico.

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE sobre el negocio, producto o servicio para el que fuiste configurado.
2. Si el usuario pregunta algo fuera de tu área o rol (política, recetas, tecnología ajena, etc.), redirígelo amablemente: reconoce la pregunta pero devuelve la conversación a tu propósito.
3. NO inventes datos, precios, características, fechas ni información que no esté en tu configuración. Si no sabes algo, dilo honestamente y ofrece derivar al equipo humano.
4. Mantén siempre un tono profesional, cálido y orientado a ayudar al cliente a tomar una buena decisión.
5. Responde en español, de forma natural y conversacional.
6. Sé conciso (máximo 2-3 oraciones por respuesta) — el usuario escucha por audio.
7. No uses listas, puntos ni formato markdown — solo texto natural para ser sintetizado en voz."""


def build_system_prompt(master_prompt: str | None = None) -> str:
    """
    Construye el system prompt final combinando las instrucciones base
    con el prompt maestro específico del cliente.
    Si no hay master_prompt, usa solo las instrucciones base genéricas.
    """
    if master_prompt and master_prompt.strip():
        return (
            BASE_INSTRUCTIONS
            + "\n\n=== TU ROL Y NEGOCIO ESPECÍFICO ===\n"
            + master_prompt.strip()
        )
    return BASE_INSTRUCTIONS


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
    system = system_prompt or BASE_INSTRUCTIONS
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
