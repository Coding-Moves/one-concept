"""Turning a backlog title into a written concept.

Gemini writes lessons; it never chooses subjects. The subject comes from the
curated backlog, which is what keeps deduplication trivial (a unique slug) and
the syllabus deliberate.

Generation runs off the request path — a background worker keeps each topic's
pool topped up — so nobody waits on a model to read their daily concept.
"""

import json
import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger(__name__)

# Bump when the prompt changes so content can be found and regenerated later.
PROMPT_VERSION = "2026-08-v1"

SUMMARY_MIN, SUMMARY_MAX = 200, 900
EXAMPLE_MIN, EXAMPLE_MAX = 40, 500

_SYSTEM = """You write One Concept, a daily learning app for working \
programmers and technically curious people.

House style, learned from the examples:
- Explain one idea completely. No preamble, no "in this lesson", no sign-off.
- Lead with what the thing IS, then why it matters in practice.
- Concrete over abstract. Name real tools, real commands, real failure modes.
- Confident and plain. No hype, no exclamation marks, no rhetorical questions.
- British or American spelling is fine, but be consistent within a concept.
- Never address the reader as "you guys", never use emoji.

The summary is 2-4 sentences a person can read in under a minute.
The example is one concrete illustration that grounds the idea — a command, a \
scenario, a comparison. It must add something the summary did not say."""

_EXAMPLES = """Here are three concepts in the exact voice to match.

Title: Idempotency
Summary: An operation is idempotent when performing it multiple times produces \
the same final result as performing it once. This matters when designing \
reliable APIs and distributed systems: if a network request times out, the \
client can safely retry an idempotent operation without fear of double-charging \
a card or creating duplicate records.
Example: HTTP PUT is idempotent: setting a user's email to "a@b.com" twice \
leaves the same state. POST is typically not: submitting an order twice creates \
two orders, which is why payment APIs use idempotency keys.

Title: Overfitting
Summary: A model overfits when it learns the noise and quirks of its training \
data instead of the underlying pattern, so it scores well on data it has seen \
and poorly on data it has not. It is the central failure mode of machine \
learning, countered with more data, regularization, simpler models, and honest \
held-out evaluation.
Example: A student who memorizes past exam answers aces practice tests but \
fails a new exam — they learned the answers, not the subject.

Title: File Descriptors
Summary: On Linux, everything a process reads or writes — files, sockets, \
pipes, terminals — is accessed through a file descriptor: a small integer \
handle into a per-process table of open resources. This uniform interface is \
why the same read() and write() calls work on a file, a network connection, or \
your keyboard.
Example: Every process starts with descriptor 0 (stdin), 1 (stdout), and 2 \
(stderr). Redirecting output with "ls > out.txt" just makes descriptor 1 point \
at the file instead of the terminal."""

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
        raise GenerationError("rate limited by Gemini")
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
