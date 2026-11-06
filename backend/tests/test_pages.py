"""Public pages must remain usable without an authenticated session."""

from httpx import ASGITransport, AsyncClient

from app.main import app

ICON_URL = "https://review.oneconcept.codingmoves.com/one-concept-icon.png"


async def test_privacy_policy_is_public_and_contains_required_contact_information():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/privacy")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Privacy Policy" in response.text
    assert "contactmuawia@gmail.com" in response.text
    assert "Expo push token" in response.text
    assert "advertising" in response.text
    assert f'href="{ICON_URL}"' in response.text


async def test_confirmation_landing_is_public_and_tells_verified_users_to_return_to_app():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/confirmed")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "Email confirmed" in response.text
    assert "One Concept" in response.text
    assert f'href="{ICON_URL}"' in response.text
