import io

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services import profile_avatar
from app.services.profile_avatar import MAX_BYTES, normalize_avatar


def test_profile_photo_is_center_cropped_and_bounded():
    source = Image.new("RGB", (900, 300), "red")
    source.paste("blue", (300, 0, 600, 300))
    raw = io.BytesIO()
    source.save(raw, format="PNG")

    result = normalize_avatar(raw.getvalue())

    assert len(result) <= MAX_BYTES
    with Image.open(io.BytesIO(result)) as saved:
        assert saved.size == (512, 512)
        assert saved.format == "JPEG"
        assert saved.getpixel((256, 256))[2] > 200
        assert saved.getpixel((256, 256))[0] < 80
        assert not saved.getexif()


def test_profile_photo_rejects_excessive_decoded_dimensions(monkeypatch):
    source = Image.new("RGB", (2, 2), "red")
    raw = io.BytesIO()
    source.save(raw, format="PNG")
    monkeypatch.setattr(profile_avatar, "MAX_PIXELS", 3)
    with pytest.raises(HTTPException) as error:
        normalize_avatar(raw.getvalue())
    assert error.value.status_code == 422
