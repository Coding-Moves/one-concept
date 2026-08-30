"""Tiny human-facing pages.

Supabase sends the post-verification redirect wherever its Site URL points.
The app is native, so there is no web app to land on — this page closes the
loop with a clear instruction instead of a dead localhost tab.
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["pages"])

_CONFIRMED = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>One Concept — email confirmed</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #0f1115; color: #e8eaf0;
           font: 18px/1.6 system-ui, sans-serif; }
    main { text-align: center; padding: 2rem; }
    h1 { font-size: 1.6rem; margin-bottom: 0.5rem; }
    p { color: #9aa1b0; }
  </style>
</head>
<body>
  <main>
    <h1>Email confirmed ✓</h1>
    <p>You're all set. Open the <strong>One Concept</strong> app on your
       phone and sign in to get today's concept.</p>
  </main>
</body>
</html>"""


@router.get("/confirmed", response_class=HTMLResponse, include_in_schema=False)
async def confirmed() -> str:
    return _CONFIRMED
