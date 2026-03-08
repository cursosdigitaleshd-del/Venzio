from typing import List, Optional
from openai import AsyncOpenAI
from loguru import logger
from config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)

# Instrucciones base que SIEMPRE se aplican — no negociables
BASE_INSTRUCTIONS = """Eres un agente de ventas virtual que atiende consultas por voz para un negocio específico.
Responde únicamente sobre el negocio, producto o servicio configurado.
Reglas:
- No inventes datos, precios o características.
- Si no sabes algo, indícalo con honestidad.
- Mantén un tono profesional, claro y amable.
- Responde en español de forma natural y conversacional.
- Sé breve: máximo 2 o 3 oraciones por respuesta.
- No uses listas ni formato markdown, solo texto natural."""


def build_system_prompt(master_prompt: str | None = None) -> str:
    """
    Construye el system prompt final combinando las instrucciones base
    con el prompt maestro específico del cliente.
    """
    system_prompt = BASE_INSTRUCTIONS
    if master_prompt and master_prompt.strip():
        system_prompt += "\n\n" + master_prompt.strip()
    return system_prompt


async def chat_completion(
    messages: list[dict],
    master_prompt: str | None = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> str:
    """
    Llama a GPT-4o mini con historial de conversación y devuelve la respuesta.
    Args:
        messages: lista de mensajes del historial de conversación
        master_prompt: prompt maestro personalizado (opcional)
        max_tokens: límite de tokens (usa config por defecto)
        temperature: temperatura (usa config por defecto)
    Returns:
        string con la respuesta del LLM
    """
    system_prompt = build_system_prompt(master_prompt)

    full_messages = [
        {"role": "system", "content": system_prompt},
    ] + messages

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
        messages=messages,
        master_prompt="Eres un analista de ventas. Responde en español con bullet points simples.",
        max_tokens=300,
        temperature=0.3,
    )
