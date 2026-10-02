from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.workers import content


@pytest.mark.parametrize("command", ["publish", "reject"])
async def test_free_text_cli_decisions_cannot_bypass_identity(
    sessionmaker_for_test, monkeypatch, command
):
    monkeypatch.setattr(content, "SessionLocal", sessionmaker_for_test)
    monkeypatch.setattr(content, "engine", SimpleNamespace(dispose=AsyncMock()))
    args = content.parser().parse_args(
        [command, str(uuid4()), "--reviewed-by", "Forged Owner", "--note", "Looks reviewed to me"]
        + (["--quality-review", "/not-read.json"] if command == "publish" else [])
    )
    with pytest.raises(ValueError, match="Free-text reviewer decisions are disabled"):
        await content.run(args)
