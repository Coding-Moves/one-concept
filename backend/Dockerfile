# The same image runs the API, scheduled workers, schema check and content CLI.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY content ./content
COPY migrations ./migrations
COPY schema ./schema
COPY operations ./operations

ARG APP_REVISION=development
ENV APP_REVISION=${APP_REVISION}
LABEL org.opencontainers.image.revision=${APP_REVISION}
LABEL org.opencontainers.image.source="https://github.com/Coding-Moves/one-concept"
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin oneconcept
USER 10001:10001

# Railway supplies $PORT; default keeps `podman run` and local use working.
ENV PORT=8000
EXPOSE 8000

# One process matches the bounded per-account limiter. exec forwards signals.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-access-log"]
