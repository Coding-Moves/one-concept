# Optional local container for the Python API and maintenance tools.
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

# Keep the port overridable for local container use.
ENV PORT=8000
EXPOSE 8000

# Never bake secrets into the image; supply them at runtime.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
