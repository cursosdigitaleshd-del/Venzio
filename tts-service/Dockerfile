FROM python:3.11-slim

WORKDIR /app

# Install Piper TTS binary from GitHub releases
# https://github.com/rhasspy/piper/releases
ARG PIPER_VERSION=2023.11.14-2
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    tar \
    && rm -rf /var/lib/apt/lists/*

# Download and install piper binary (Linux x86_64)
RUN wget -q "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" -O /tmp/piper.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /usr/local/bin/ --strip-components=1 \
    && rm /tmp/piper.tar.gz \
    && chmod +x /usr/local/bin/piper

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Directory where .onnx voice model files will be mounted
RUN mkdir -p /app/models

ENV PIPER_MODELS_DIR=/app/models

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002", "--log-level", "info"]
