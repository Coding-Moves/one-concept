"""Private, API-owned avatar storage.

The mobile app sends a cropped image only after an explicit user action. This
service re-encodes it to a small JPEG before putting it in a private Supabase
bucket; database rows retain only the object key. No client receives the
service role key or may choose an arbitrary object path.
"""
import io
import uuid

import httpx
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import Settings

BUCKET = "profile-avatars"
MAX_BYTES = 262_144
PRESETS = {"aurora", "comet", "forest", "ocean", "sunset", "violet"}


def is_preset(value: str | None) -> bool:
    return bool(value and value.startswith("preset:") and value[7:] in PRESETS)


def is_object_key(value: str | None) -> bool:
    return bool(value and value.startswith("avatars/"))


def normalize_bio(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    if not text:
        return None
    if len(text) > 160:
        raise ValueError("Bio must be 160 characters or fewer")
    return text


def normalize_avatar(data: bytes) -> bytes:
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Choose an image smaller than 5 MB")
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.verify()
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            side = min(image.size)
            left = (image.width - side) // 2
            top = (image.height - side) // 2
            canvas = image.crop((left, top, left + side, top + side)).resize(
                (512, 512), Image.Resampling.LANCZOS
            )
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(422, "Choose a valid photo in JPEG, PNG, or WebP format") from None
    for quality in (85, 78, 70, 62, 54):
        out = io.BytesIO()
        canvas.save(out, format="JPEG", quality=quality, optimize=True)
        if out.tell() <= MAX_BYTES:
            return out.getvalue()
    raise HTTPException(422, "That photo cannot be reduced enough. Choose a simpler image.")


def _headers(settings: Settings) -> dict[str, str]:
    if not settings.supabase_service_role_key:
        raise HTTPException(503, "Photo uploads are not configured yet. Choose a built-in avatar instead.")
    return {"Authorization": f"Bearer {settings.supabase_service_role_key}", "apikey": settings.supabase_service_role_key}


async def upload_avatar(settings: Settings, user_id: uuid.UUID, data: bytes) -> str:
    key = f"avatars/{user_id}/{uuid.uuid4().hex}.jpg"
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}/{key}"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(url, headers={**_headers(settings), "Content-Type": "image/jpeg", "x-upsert": "false"}, content=data)
    if response.status_code >= 300:
        raise HTTPException(503, "We could not save your photo. Please try again.")
    return key


async def delete_avatar(settings: Settings, key: str | None) -> None:
    if not is_object_key(key) or not settings.supabase_service_role_key:
        return
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}"
    async with httpx.AsyncClient(timeout=10) as client:
        await client.request("DELETE", url, headers=_headers(settings), json={"prefixes": [key]})


async def signed_avatar_url(settings: Settings, key: str | None) -> str | None:
    if not is_object_key(key) or not settings.supabase_service_role_key:
        return None
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/{BUCKET}/{key}"
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(url, headers=_headers(settings), json={"expiresIn": 120})
    if response.status_code >= 300:
        return None
    path = response.json().get("signedURL")
    return f"{settings.supabase_url.rstrip('/')}/storage/v1{path}" if isinstance(path, str) else None
