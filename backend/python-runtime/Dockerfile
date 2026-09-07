FROM python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    XDG_CACHE_HOME=/tmp/.cache \
    HOME=/tmp \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install --only-binary=:all: -r /tmp/requirements.lock \
    && python -m pip check \
    && rm -f /tmp/requirements.lock

LABEL org.opencontainers.image.title="MSP Python Runtime" \
      org.opencontainers.image.version="2026.09.07-1" \
      org.opencontainers.image.description="Offline one-shot Python runtime for NAS Note Studio"
