# 🎙 Venzio – Plataforma SaaS de Agente Vendedor por Voz

Plataforma de IA conversacional que permite a empresas desplegar un agente de ventas por voz totalmente automatizado, accesible desde cualquier sitio web mediante un widget JavaScript embebible.

## Arquitectura

```
c:\Venzio\
├── fastapi-core/       # API principal (WebSocket + REST + Admin)
├── stt-service/        # Transcripción de voz (faster-whisper)
├── tts-service/        # Síntesis de voz (Piper TTS)
├── widget/             # Widget JS embebible
├── admin/              # Panel de administración (HTML + JWT)
├── nginx/              # Reverse proxy config
├── models/             # Modelos Whisper y Piper (.onnx)  ← crear tú
│   ├── whisper/
│   └── piper/
├── data/               # SQLite DB (auto-creada)
├── docker-compose.yml
└── .env.example
```

## Inicio rápido

### 1. Variables de entorno
```bash
cp .env.example .env
# Edita .env y completa OPENAI_API_KEY y SECRET_KEY
```

### 2. Modelo de voz Piper (español)
Descarga el modelo de voz y su configuración, y colócalos en `models/piper/`:
```bash
# es_ES-davefx-medium  (recomendado para inicio)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx \
     -O models/piper/es_ES-davefx-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json \
     -O models/piper/es_ES-davefx-medium.onnx.json
```

### 3. Levantar con Docker Compose
```bash
docker compose up --build
```

Servicios disponibles:
| URL | Servicio |
|---|---|
| http://localhost:8000/docs | FastAPI Core (Swagger) |
| http://localhost:8001 | STT Service |
| http://localhost:8002 | TTS Service |
| http://localhost/admin/ | Panel Admin |
| http://localhost/widget/ | Widget Demo |

### 4. Credenciales de admin por defecto
Definidas en `.env`:
```
ADMIN_EMAIL=admin@venzio.com
ADMIN_PASSWORD=Admin1234!
```

---

## Desarrollo local (sin Docker)

### FastAPI Core
```bash
cd fastapi-core
pip install -r requirements.txt
cp ../.env.example .env  # editar
uvicorn main:app --reload --port 8000
```

### STT Service
```bash
cd stt-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### TTS Service
```bash
# Instalar Piper en tu sistema: https://github.com/rhasspy/piper/releases
cd tts-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

### Widget (demo)
Abre directamente en el navegador:
```
c:\Venzio\widget\index.html
```
O sirve con cualquier HTTP server:
```bash
npx serve widget/
```

---

## Pipeline de voz (WebSocket)

```
Cliente (WebRTC mic)
    │  audio bytes (WAV/WebM)
    ▼
[fastapi-core] /ws/voice/{voice_id}
    │  HTTP POST /transcribe
    ▼
[stt-service]  faster-whisper (español)
    │  {"text": "..."}
    ▼
[fastapi-core] GPT-4o mini (OpenAI)
    │  HTTP GET /synthesize?text=...&voice=...
    ▼
[tts-service]  Piper TTS
    │  audio bytes (WAV)
    ▼
Cliente (AudioContext playback)
```

---

## Embeber el widget en WordPress (o cualquier sitio)

```html
<script
  src="https://TU_DOMINIO/widget/embed.js"
  data-api="https://TU_DOMINIO"
  data-name="Mi Agente de Ventas">
</script>
```

---

## Migraciones de base de datos (Alembic)

```bash
cd fastapi-core
# Crear nueva migración
alembic revision --autogenerate -m "descripcion"
# Aplicar migraciones
alembic upgrade head
```

---

## Agregar una nueva voz TTS

1. Descarga el archivo `.onnx` desde [Piper Voices](https://huggingface.co/rhasspy/piper-voices)
2. Cópialo a `models/piper/`
3. Abre el **Panel Admin** → tab **Voces TTS** → **+ Agregar voz**
4. Completa nombre, idioma y nombre del archivo `.onnx`
5. La nueva voz aparece inmediatamente en el widget

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Base de datos | SQLite → PostgreSQL (futuro) |
| ORM + Migraciones | SQLAlchemy 2.0 + Alembic |
| Autenticación | JWT (python-jose) + bcrypt (passlib) |
| STT | faster-whisper (Modelo: base, Idioma: español) |
| TTS | Piper TTS (.onnx voices) |
| LLM | GPT-4o mini (OpenAI) |
| Frontend Widget | JavaScript vanilla + WebRTC + WebSocket |
| Panel Admin | HTML/CSS/JS puro, dark-mode |
| Contenedores | Docker + Docker Compose |
| Proxy | Nginx (rate-limit + WebSocket upgrade) |
| Webhooks | n8n (WhatsApp Cloud API / Twilio) |
| Logs | loguru |

---

## Preparación para escalar (producción)

- **PostgreSQL**: cambia `DATABASE_URL` en `.env` → sin cambios en código
- **GPU para STT**: mueve `stt-service` a servidor con CUDA, cambia `device="cuda"` en `transcriber.py`
- **GPU para TTS**: mismo patrón
- **Redis + sesiones horizontales**: reemplaza `concurrency.py` por backend Redis
- **Kubernetes**: los `Dockerfile` están preparados, agrega Helm Charts

---

## Licencia
MIT – Venzio 2026
