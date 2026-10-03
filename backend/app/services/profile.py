"""Private profile input rules shared by authenticated profile writes."""

import unicodedata

MAX_DISPLAY_NAME_LENGTH = 60


def normalize_display_name(value: str) -> str:
    """Keep a preferred name readable without restricting legitimate scripts."""
    normalized = unicodedata.normalize("NFC", value).strip()
    if not normalized:
        raise ValueError("Display name cannot be empty")
    if len(normalized) > MAX_DISPLAY_NAME_LENGTH:
        raise ValueError(f"Display name must be {MAX_DISPLAY_NAME_LENGTH} characters or fewer")
    if any(unicodedata.category(character).startswith("C") for character in normalized):
        raise ValueError("Display name contains unsupported characters")
    return normalized
