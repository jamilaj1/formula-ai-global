# =============================================================================
# Formula AI Global — Production Dockerfile (multi-stage)
# =============================================================================

FROM python:3.11-slim AS builder

WORKDIR /build

# System deps for compiling python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# =============================================================================
FROM python:3.11-slim AS production

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages
COPY --from=builder /usr/local /usr/local

# Copy app source
COPY main.py .
COPY auth.py .
COPY billing.py .
COPY ai_brain ./ai_brain
COPY knowledge_collector ./knowledge_collector
COPY services ./services
COPY app ./app
COPY bots ./bots

# Create non-root user
RUN useradd --create-home --shell /bin/bash --uid 1000 formula && \
    chown -R formula:formula /app

USER formula

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]