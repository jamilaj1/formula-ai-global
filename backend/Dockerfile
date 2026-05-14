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

# Copy app source — every Python directory the code imports from
COPY main.py .
COPY auth.py .
COPY billing.py .
COPY ai_brain ./ai_brain
COPY knowledge_collector ./knowledge_collector
COPY services ./services
COPY app ./app
COPY bots ./bots
COPY ml ./ml
COPY agents ./agents
COPY cron ./cron

# Create non-root user
RUN useradd --create-home --shell /bin/bash --uid 1000 formula && \
    chown -R formula:formula /app

USER formula

# Render dynamically sets PORT; default to 8000 for local docker run.
ENV PORT=8000

# Health check — uses runtime PORT so it works on Render and locally.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

EXPOSE 8000

# Shell form so ${PORT} is expanded by the shell at container start.
# Workers=2 (not 4) — RDKit holds ~150 MB per worker; 4 workers OOMs on
# the 512 MB Render Starter plan. Bump to 4 only on Standard or higher.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 2