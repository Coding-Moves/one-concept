"""Turning a backlog title into a written concept.

Gemini writes lessons; it never chooses subjects. The subject comes from the
curated backlog, which is what keeps deduplication trivial (a unique slug) and
the syllabus deliberate.

Generation runs off the request path — a background worker keeps each topic's
pool topped up — so nobody waits on a model to read their daily concept.
"""

import json
import logging
import re
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

# Bump when the prompt changes so content can be found and regenerated later.
PROMPT_VERSION = "2026-08-v2"

SUMMARY_MIN, SUMMARY_MAX = 100, 420
EXAMPLE_MIN, EXAMPLE_MAX = 40, 300

_SYSTEM = """You write One Concept, a daily learning app. Each lesson is read \
in thirty seconds over morning coffee.

Voice: a sharp friend explaining something across the table. Not a textbook, \
not a blog post, not documentation.

Rules, in order of importance:
- 2 to 3 short sentences for the summary. Never more.
- Plain everyday words. If a simpler word exists, use it.
- Say the interesting thing directly. Cut every sentence that merely sounds \
informative.
- BANNED words and moves: "leverage", "robust", "crucial", "facilitates", \
"enables", "utilize", "furthermore", "in essence", "plays a vital role", \
"in the world of", any sentence that starts by restating the title.
- The example is ONE concrete moment a person can picture — a command they \
might type, a thing that happened, a comparison to daily life. One or two \
short sentences.
- No preamble, no sign-off, no hype, no emoji, no rhetorical questions."""

_EXAMPLES = """Here are three lessons in the exact voice to match.

Title: Idempotency
Summary: An operation is idempotent when doing it twice leaves things exactly \
as if you did it once. That one property is what makes retries safe — if the \
network dies mid-request, the client can just try again without breaking \
anything.
Example: Pressing an elevator button five times doesn't call five elevators. \
Submitting an online order twice, though, buys two — which is why payment \
systems work hard to be idempotent.

Title: Overfitting
Summary: A model overfits when it memorizes its training data instead of \
learning the pattern behind it. It looks brilliant on data it has seen and \
falls apart on anything new.
Example: A student who memorizes last year's exam answers aces every practice \
test — then fails the real exam, because they learned the answers, not the \
subject.

Title: File Descriptors
Summary: On Linux, everything a program reads or writes — files, network \
connections, your keyboard — is handled through a file descriptor: a small \
number that stands for an open resource. One simple interface, so the same \
code can read from any of them.
Example: Every program starts with three: 0 is input, 1 is output, 2 is \
errors. Typing "ls > out.txt" just points number 1 at a file instead of your \
screen."""

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["summary", "example"],
}


class GenerationError(RuntimeError):
    """Generation failed in a way worth recording against the backlog item."""


class RateLimitedError(GenerationError):
    """Gemini said slow down. Not the backlog item's fault — retry it later."""

    def __init__(self, retry_after: float | None = None):
        super().__init__("rate limited by Gemini")
        self.retry_after = retry_after


def _retry_after_seconds(response: httpx.Response) -> float | None:
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    # Google puts RetryInfo in the error body: "retryDelay": "12s".
    match = re.search(r'"retryDelay":\s*"(\d+(?:\.\d+)?)s"', response.text)
    return float(match.group(1)) if match else None


@dataclass
class GeneratedConcept:
    summary: str
    example: str
    model: str
    prompt_version: str = PROMPT_VERSION


def build_prompt(title: str, topic_name: str, angle: str | None) -> str:
    steer = f"\nAngle to take: {angle}" if angle else ""
    return (
        f"{_SYSTEM}\n\n{_EXAMPLES}\n\n"
        f"Now write the concept below.\n\n"
        f"Topic area: {topic_name}\n"
        f"Title: {title}{steer}\n\n"
        "Return JSON with exactly the keys \"summary\" and \"example\"."
    )


def validate(payload: dict, title: str) -> tuple[str, str]:
    """Reject anything that would embarrass us in front of a user.

    A model that returns something odd should leave the backlog item pending,
    not put malformed text in front of a reader.
    """
    if not isinstance(payload, dict):
        raise GenerationError("response was not a JSON object")

    summary = (payload.get("summary") or "").strip()
    example = (payload.get("example") or "").strip()

    if not summary or not example:
        raise GenerationError("summary or example was empty")
    if not (SUMMARY_MIN <= len(summary) <= SUMMARY_MAX):
        raise GenerationError(f"summary length {len(summary)} outside {SUMMARY_MIN}-{SUMMARY_MAX}")
    if not (EXAMPLE_MIN <= len(example) <= EXAMPLE_MAX):
        raise GenerationError(f"example length {len(example)} outside {EXAMPLE_MIN}-{EXAMPLE_MAX}")

    lowered = summary.lower()
    # Meta-commentary means the model narrated the task instead of doing it.
    for phrase in ("in this lesson", "as an ai", "i cannot", "here is", "sure,", "certainly,"):
        if lowered.startswith(phrase):
            raise GenerationError(f"summary opens with boilerplate: {phrase!r}")
    # The tells of machine-flavoured filler; a lesson containing them gets rewritten.
    for phrase in ("leverage", "crucial", "furthermore", "in the world of",
                   "plays a vital role", "in essence", "facilitates"):
        if phrase in lowered:
            raise GenerationError(f"summary contains banned filler: {phrase!r}")
    if "```" in summary or "```" in example:
        raise GenerationError("response contained a code fence")
    if summary == example:
        raise GenerationError("example merely repeats the summary")

    return summary, example


async def generate_concept(
    *,
    title: str,
    topic_name: str,
    angle: str | None,
    api_key: str,
    model: str,
    timeout: float = 45.0,
) -> GeneratedConcept:
    """Ask Gemini for one lesson. Raises GenerationError on anything unusable."""
    if not api_key:
        raise GenerationError("GEMINI_API_KEY is not configured")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "contents": [{"parts": [{"text": build_prompt(title, topic_name, angle)}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 800,
            "responseMimeType": "application/json",
            "responseSchema": _RESPONSE_SCHEMA,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=body, headers={"x-goog-api-key": api_key})
    except httpx.HTTPError as exc:
        raise GenerationError(f"request failed: {exc}") from exc

    if response.status_code == 429:
        raise RateLimitedError(_retry_after_seconds(response))
    if response.status_code >= 400:
        raise GenerationError(f"Gemini returned {response.status_code}: {response.text[:200]}")

    try:
        candidates = response.json()["candidates"]
        text = candidates[0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError) as exc:
        raise GenerationError(f"unexpected response shape: {exc}") from exc

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise GenerationError(f"response was not valid JSON: {exc}") from exc

    summary, example = validate(payload, title)
    return GeneratedConcept(summary=summary, example=example, model=model)
