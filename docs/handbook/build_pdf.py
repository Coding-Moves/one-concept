"""Render the engineering handbook with selectable text and vector diagrams.

Usage: python docs/handbook/build_pdf.py
Requires reportlab. See README.md in this directory for reproducible setup.
"""

from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Flowable, Paragraph, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
REV = "3cc5af3382ba8e735be573d0ccb7f79ef6af9181"
REPO = "https://github.com/Coding-Moves/one-concept"
CHAPTERS = 47
DIAGRAMS = 29
PW, PH = A4
MARGIN = 43
WIDTH = PW - 2 * MARGIN
NAVY = colors.HexColor("#162D45")
TEAL = colors.HexColor("#087F82")
INK = colors.HexColor("#25394B")
MUTED = colors.HexColor("#5C6F7F")
PALE = colors.HexColor("#F2F6F8")
LINE = colors.HexColor("#DCE5EA")
AMBER = colors.HexColor("#A36810")


def fonts(font_dir: Path | None):
    runtime = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies"
    options = [font_dir] if font_dir else []
    options += [Path("/usr/share/fonts/truetype/liberation2"),
                Path("/usr/share/fonts/truetype/liberation"),
                runtime / "native/libreoffice-headless/libreoffice/share/fonts/truetype"]
    for directory in options:
        if directory and (directory / "LiberationSans-Regular.ttf").is_file():
            for name, filename in [("Body", "LiberationSans-Regular.ttf"),
                                   ("Bold", "LiberationSans-Bold.ttf"),
                                   ("Italic", "LiberationSans-Italic.ttf"),
                                   ("Mono", "LiberationMono-Regular.ttf")]:
                path = directory / filename
                if name == "Mono" and not path.exists():
                    path = directory / "DejaVuSansMono.ttf"
                pdfmetrics.registerFont(TTFont(name, str(path)))
            pdfmetrics.registerFontFamily("Body", normal="Body", bold="Bold", italic="Italic")
            return
    raise RuntimeError("Install Liberation fonts or pass --font-dir containing Liberation Sans and Mono.")


def inline(text: str) -> str:
    """Only render the small Markdown subset used by the source, escaping first."""
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\((https://[^ )]+)\)",
                  r'<a href="\2" color="#087F82">\1</a>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)

    def code(match):
        raw = html.unescape(match[1])
        p = ROOT / raw
        label = f'<font name="Mono">{match[1]}</font>'
        if p.exists() and ("/" in raw or raw.endswith(".md")):
            kind = "tree" if p.is_dir() else "blob"
            return f'<a href="{REPO}/{kind}/{REV}/{raw}" color="#087F82">{label}</a>'
        return label

    return re.sub(r"`([^`]+)`", code, text)


def styles(scale=1):
    return {
        "body": ParagraphStyle("body", fontName="Body", fontSize=10.15 * scale,
                               leading=14.25 * scale, textColor=INK, spaceAfter=7 * scale),
        "cell": ParagraphStyle("cell", fontName="Body", fontSize=9.0 * scale,
                               leading=11.85 * scale, textColor=INK),
        "head": ParagraphStyle("head", fontName="Bold", fontSize=9.0 * scale,
                               leading=11.85 * scale, textColor=colors.white),
        "source": ParagraphStyle("source", fontName="Body", fontSize=7.8 * scale,
                                 leading=10.5 * scale, textColor=MUTED),
    }


class Diagram(Flowable):
    """Vector boxes/arrows; node labels are measured to prohibit clipping."""

    def __init__(self, key, number, scale=1):
        super().__init__()
        self.key, self.number = key, number
        self.factor = (WIDTH / 520) * scale
        self.width = WIDTH
        self.base_h = 188 if key not in {"selection", "database", "release"} else 215
        if key == "editorial":
            self.base_h = 176
        self.height = self.base_h * self.factor + 8
        self.nodes = {}

    def box(self, key, x, y, w, h, title, body="", tone="teal"):
        self.nodes[key] = (x, y, w, h, title, body, tone)

    def edge(self, a, b, label="", via=None):
        ca = self.nodes[a][:4]
        cb = self.nodes[b][:4]
        ax, ay = ca[0] + ca[2] / 2, ca[1] + ca[3] / 2
        bx, by = cb[0] + cb[2] / 2, cb[1] + cb[3] / 2
        dx, dy = bx - ax, by - ay
        if via:
            points = via
        else:
            k1 = min(ca[2] / 2 / abs(dx) if dx else float("inf"),
                     ca[3] / 2 / abs(dy) if dy else float("inf"))
            k2 = min(cb[2] / 2 / abs(dx) if dx else float("inf"),
                     cb[3] / 2 / abs(dy) if dy else float("inf"))
            points = [(ax + k1 * dx, ay + k1 * dy), (bx - k2 * dx, by - k2 * dy)]
        self.arrow(points, label)

    def arrow(self, points, label=""):
        c = self.canv
        pts = [(x, self.base_h - y) for x, y in points]
        c.setStrokeColor(MUTED)
        c.setFillColor(MUTED)
        c.setLineWidth(0.9)
        p = c.beginPath()
        p.moveTo(*pts[0])
        for point in pts[1:]:
            p.lineTo(*point)
        c.drawPath(p)
        (x1, y1), (x2, y2) = pts[-2:]
        angle = math.atan2(y2 - y1, x2 - x1)
        p = c.beginPath()
        p.moveTo(x2, y2)
        p.lineTo(x2 - 5 * math.cos(angle - .45), y2 - 5 * math.sin(angle - .45))
        p.lineTo(x2 - 5 * math.cos(angle + .45), y2 - 5 * math.sin(angle + .45))
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        if label:
            lx, ly = (pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2 + 4
            c.setFont("Body", 7.5)
            tw = pdfmetrics.stringWidth(label, "Body", 7.5)
            c.setFillColor(PALE)
            c.rect(lx - tw / 2 - 3, ly - 1, tw + 6, 10, fill=1, stroke=0)
            c.setFillColor(MUTED)
            c.drawCentredString(lx, ly, label)

    def note(self, text, y=171):
        c = self.canv
        c.setFont("Italic", 8)
        c.setFillColor(MUTED)
        c.drawCentredString(260, self.base_h - y, text)

    def row(self, items, y=43, height=49, gap=25):
        w = (488 - gap * (len(items) - 1)) / len(items)
        keys = []
        for i, item in enumerate(items):
            key = str(len(self.nodes))
            self.box(key, 16 + i * (w + gap), y, w, height, *item)
            keys.append(key)
        for a, b in zip(keys, keys[1:]):
            self.edge(a, b)
        return keys

    def sequence(self, actors, steps):
        c = self.canv
        count = len(actors)
        xs = [62 + i * 396 / (count - 1) for i in range(count)]
        for i, name in enumerate(actors):
            self.box(str(i), xs[i] - 49, 31, 98, 25, name)
            c.setDash(2, 3)
            c.setStrokeColor(LINE)
            c.line(xs[i], self.base_h - 58, xs[i], 24)
            c.setDash()
        for i, (a, b, text) in enumerate(steps):
            y = 75 + i * 22
            self.arrow([(xs[a], y), (xs[b], y)], text)

    def draw(self):
        c = self.canv
        c.saveState()
        c.scale(self.factor, self.factor)
        c.setFillColor(PALE)
        c.roundRect(0, 0, 520, self.base_h, 9, fill=1, stroke=0)
        c.setFillColor(TEAL)
        c.setFont("Bold", 8)
        title = self.key.replace("_", " ").upper()
        c.drawString(14, self.base_h - 17, f"FIGURE {self.number:02d}  /  {title}")
        b, e = self.box, self.edge
        key = self.key
        if key == "architecture":
            b("m", 15, 35, 137, 46, "Mobile app", "UI, cache, outbox")
            b("a", 191, 35, 137, 46, "FastAPI", "Trusted app rules")
            b("d", 367, 35, 137, 46, "PostgreSQL", "Shared + personal data")
            b("u", 15, 112, 137, 42, "Supabase Auth", "Sessions + account email")
            b("w", 191, 112, 137, 42, "Python workers", "Refill + reminder decisions")
            b("p", 367, 112, 137, 42, "Gemini / Expo Push", "Write content / route pushes")
            e("m", "a", "JWT"); e("a", "d", "SQL")
            e("u", "m", "identity"); e("w", "a", "shared services")
            e("w", "p", "HTTPS"); e("d", "w", "job state")
        elif key == "navigation":
            self.row([("Launch", "Splash + session"), ("Auth or tabs", "Session gates access"),
                      ("Detail modal", "Open a lesson")], 40, 44)
            for i, (title, body) in enumerate([("Today", "Daily lesson"), ("History", "Last 10 learned"),
                                               ("Stats", "Totals + streaks"), ("Profile", "Saved, topics, settings")]):
                b("tab" + str(i), 16 + i * 124, 116, 116, 40, title, body)
            self.note("Profile contains Personalization, Saved and About.")
        elif key == "startup":
            self.sequence(["Device cache", "React state", "FastAPI", "PostgreSQL"],
                          [(0, 1, "paint last known state"), (1, 2, "GET state + token"),
                           (2, 3, "aggregate + get/create daily"), (2, 1, "reconcile with pending actions")])
        elif key == "auth":
            self.sequence(["Phone", "Supabase Auth", "FastAPI", "Database"],
                          [(0, 1, "email + password"), (1, 0, "session / access token"),
                           (0, 2, "request with bearer JWT"), (2, 3, "verified user-scoped SQL")])
        elif key == "email":
            self.row([("Account action", "Signup / recovery / change"), ("Supabase Auth", "Select template + link"),
                      ("Configured SMTP", "Deliver to inbox")], 47, 58)
            self.note("HTML source in GitHub must be installed in Supabase separately.", 142)
            self.note("Learning reminder pushes use a different system.", 160)
        elif key == "recovery":
            self.sequence(["App", "Supabase Auth", "Inbox", "Reset web page"],
                          [(0, 1, "request recovery"), (1, 2, "email verification link"),
                           (2, 3, "verified redirect + fragment"), (3, 1, "new password + recovery JWT")])
        elif key == "backend":
            self.row([("HTTP request", "Bearer token + JSON"), ("FastAPI route", "Auth + schema"),
                      ("Service", "Selection / interaction"), ("Database", "Commit + response")], 48, 62, 17)
            self.note("Generation requests run outside the daily response path.", 145)
        elif key == "database":
            for args in [("u", 16, 34, 140, 39, "auth.users", "Supabase-managed identity"),
                         ("p", 16, 105, 140, 39, "profiles", "One per user"),
                         ("a", 189, 105, 140, 39, "daily_assignments", "User + date + concept"),
                         ("c", 363, 105, 140, 39, "concepts", "Shared written lessons"),
                         ("t", 363, 34, 140, 39, "topics", "Shared subject catalog"),
                         ("f", 189, 34, 140, 39, "user_topics", "Follow relationships"),
                         ("n", 16, 172, 140, 30, "Preferences + tokens", ""),
                         ("i", 189, 172, 140, 30, "Interactions", "Like / save"),
                         ("o", 363, 172, 140, 30, "Operational tables", "Backlog, budget, claims")]:
                b(*args)
            for a, z, label in [("u", "p", "1:1"), ("p", "a", "1:many"),
                                ("t", "c", "1:many"), ("c", "a", "1:many"),
                                ("p", "f", "follows"), ("t", "f", "topic"),
                                ("p", "n", "owns"), ("p", "i", "owns")]: e(a, z, label)
        elif key == "selection":
            b("s", 17, 34, 152, 38, "Existing assignment?", "For this user's local day")
            b("r", 348, 34, 155, 38, "Return stored lesson", "No re-selection")
            b("f", 17, 95, 152, 38, "Followed candidates?", "Exclude all prior assignments")
            b("p", 193, 95, 135, 38, "Pick candidate", "Topic recency + random")
            b("i", 348, 95, 155, 38, "Persist assignment", "Unique user/day + user/concept")
            b("g", 17, 159, 152, 38, "Global candidates?", "Same no-repeat rule")
            b("x", 193, 159, 135, 38, "Exhausted", "No eligible global concept", "amber")
            e("s", "r", "yes"); e("s", "f", "no"); e("f", "p", "yes")
            e("p", "i"); e("f", "g", "no"); e("g", "x", "no")
            e("g", "p", "yes", [(169, 178), (183, 178), (183, 114), (193, 114)])
        elif key == "multiuser":
            b("c", 188, 36, 144, 42, "One shared catalog", "Lessons stay after reading")
            b("a", 23, 112, 213, 42, "Ali: AI + Mathematics", "Own assignment and completion history")
            b("s", 285, 112, 213, 42, "Sara: Software Engineering", "Own assignment and completion history")
            e("c", "a", "eligible for Ali"); e("c", "s", "eligible for Sara")
        elif key == "completion":
            self.row([("Tap learned", "Immediate UI response"), ("POST complete", "Server picks eligible day"),
                      ("Persist timestamp", "Idempotent completion")], 43, 50)
            b("s", 55, 121, 175, 36, "Derived streaks", "Completed assigned_for dates")
            b("n", 291, 121, 175, 36, "Later reminder checks", "Completed day is excluded")
            e("2", "n"); e("2", "s")
        elif key == "exhaustion":
            b("p", 17, 40, 148, 51, "Shared published = 25", "Reading does not delete rows")
            b("a", 188, 40, 148, 51, "Ali remaining = 0", "All 25 previously assigned", "amber")
            b("s", 359, 40, 148, 51, "Sara remaining = 20", "Only 5 previously assigned")
            b("w", 17, 117, 148, 39, "Worker target = 25", "No shared deficit")
            b("f", 188, 117, 148, 39, "Prefetch target = 10", "Already exceeded: no refill", "amber")
            b("r", 359, 117, 148, 39, "Sara continues", "Her candidates remain")
            e("p", "w"); e("a", "f"); e("s", "r")
        elif key == "generation":
            self.row([("Curated title", "Pending backlog"), ("Claim + budget", "Atomic DB transaction"),
                      ("Gemini request", "Commit precedes call")], 40, 48)
            b("v", 190, 114, 143, 42, "Validate text", "Shape, length, phrasing")
            b("p", 17, 114, 143, 42, "Publish globally", "Concept + provenance")
            e("2", "v"); e("v", "p")
            self.note("One successful publication can serve many independent users.")
        elif key == "budget":
            b("a", 16, 39, 143, 43, "API prefetch", "")
            b("b", 189, 39, 143, 43, "Scheduled refill", "")
            b("c", 362, 39, 143, 43, "Manual rewrite", "")
            b("l", 123, 115, 275, 42, "Shared Pacific-day ledger", "Reserve atomically; commit before provider call")
            for x in ("a", "b", "c"): e(x, "l")
            self.note("Restarting a process does not reset the day's reserved calls.")
        elif key == "growth":
            self.row([("New topic or title", "Curated data change"), ("Published concept", "Seed or allowed generation"),
                      ("Future API selection", "User has never received it")], 45, 58)
            self.note("New catalog data does not replace today's pinned assignment.", 140)
            self.note("Publishing content does not send a new-content notification.", 158)
        elif key == "push":
            self.row([("Permission", "Phone + OS"), ("Expo token", "Register via API"),
                      ("Due worker", "Choose user/time slot"), ("Expo Push", "FCM / APNs to device")], 47, 63, 16)
            self.note("Registration identifies where to send; the worker decides when.", 146)
        elif key == "reminders":
            b("t", 16, 38, 148, 47, "15-minute pass", "Translate clock per profile")
            b("d", 189, 38, 148, 47, "Due and enabled?", "Token exists; day unfinished")
            b("c", 362, 38, 148, 47, "Claim slot", "Unique user/date/time")
            b("s", 362, 119, 148, 40, "Send Expo batch", "Claims already committed")
            b("n", 16, 119, 321, 40, "Skip or already claimed", "No candidate, completed date or conflicting claim")
            e("t", "d"); e("d", "c", "yes"); e("c", "s", "won")
            e("d", "n", "no"); e("c", "n", "lost")
        elif key == "reminder_day":
            self.row([("08:00", "Morning reminder"), ("08:10", "Online completion"),
                      ("14:00", "Suppressed"), ("20:00", "Suppressed")], 48, 58, 19)
            self.note("Example in the user's profile timezone, assuming normal worker execution.", 141)
            self.note("Only server-confirmed completion affects the worker's next decision.", 161)
        elif key == "offline_storage":
            b("s", 171, 35, 178, 41, "Successful online state load", "Render now; download saved bodies")
            for i, (t, body) in enumerate([("Progress snapshot", "Dates, totals, membership"),
                                            ("Full concept bodies", "Explanation + example"),
                                            ("Topics + saved metadata", "Choices, titles, filters")]):
                b(str(i), 16 + i * 174, 112, 144, 43, t, body); e("s", str(i))
            self.note("Only completed downloads are available on an offline restart.")
        elif key == "sync":
            self.row([("Tap while offline", "Optimistic UI"), ("Durable outbox", "Latest desired state"),
                      ("Foreground retry", "5 / 10 / 20 / 30 seconds")], 42, 50)
            b("r", 16, 118, 230, 40, "Success: reconcile", "Merge server state with remaining intentions")
            b("f", 281, 118, 222, 40, "Failure: retain or reject", "Network/5xx retry; stale day/4xx dropped")
            e("2", "f"); e("2", "r")
        elif key == "release":
            self.row([("Feature branch", "Focused commits"), ("PR to develop", "Review + preview"),
                      ("Release PR", "Version + migration check")], 36, 45)
            b("m", 362, 112, 143, 40, "Merge main", "Production trigger")
            b("e", 189, 112, 143, 40, "EAS production OTA", "Then preview + GitHub release")
            b("a", 16, 112, 143, 40, "APK workflow", "Rebuild only for new runtime")
            b("r", 362, 173, 143, 29, "Railway deployment", "Independent backend path")
            e("2", "m"); e("m", "e"); e("e", "a"); e("m", "r")
        elif key == "ota":
            b("b", 21, 42, 213, 61, "Installed APK", "Native runtime 1.3.0")
            b("u", 286, 42, 213, 61, "Compatible OTA", "App version 1.8.0; runtime 1.3.0")
            e("u", "b", "match")
            self.note("Marketing version can change while the native runtime remains fixed.", 138)
            self.note("A matching highlight entry is shown until this device dismisses it.", 157)
        elif key == "cost":
            b("g", 17, 49, 146, 55, "One generated lesson", "Shared writing cost")
            b("c", 190, 49, 146, 55, "One catalog row", "Reusable published content")
            b("u", 363, 49, 146, 55, "Many learners", "Separate progress records")
            e("g", "c"); e("c", "u")
            self.note("Illustration: 1 lesson can serve 1,000 readers; failed attempts still cost calls.", 143)
        elif key == "future_lifecycle":
            self.row([("Plan curriculum", "Reviewed title pipeline"), ("Draft + approve", "Quality-controlled content"),
                      ("Shared publication", "Bounded continuing supply")], 38, 49)
            b("l", 16, 118, 230, 39, "Daily fresh learning", "Personal eligibility; stored approved content")
            b("r", 282, 118, 221, 39, "Review when fresh is unavailable", "Separate practice and honest metrics")
            e("2", "l"); e("2", "r")
            self.note("PROPOSED #195: operations monitor both supply and learning continuity.")
        elif key == "runway":
            self.row([("Reader availability", "Experienced active cohort"), ("Durable subject goal", "Coalesce repeated signals"),
                      ("Bounded worker", "Claims + shared call budget")], 40, 52)
            b("p", 118, 119, 282, 36, "Approved new supply increases the reserve", "Consumption reduces it; future checks remeasure it")
            e("2", "p")
            self.note("PROPOSED #195: a reserve is a buffer, not unlimited content.")
        elif key == "editorial":
            self.row([("Plan / import", "Objectives + overlap check"), ("Draft", "AI-assisted or editorial"),
                      ("Review", "Correctness + usefulness"), ("Publish", "Approved version")], 43, 58, 16)
            self.note("PROPOSED #195: an unreviewed draft does not count as available supply.", 139)
            self.note("Corrections retain the concept identity and its saved/history references.", 159)
        elif key == "review_schema":
            b("a", 18, 38, 217, 44, "Existing new-concept assignments", "Preserve unique user/day and user/concept")
            b("r", 284, 38, 217, 44, "Proposed review/activity records", "Separate identity, date and completion")
            b("m", 122, 122, 280, 35, "Daily activity: distinct completed local dates", "One day of streak credit; separate new/review totals")
            e("a", "m"); e("r", "m")
            self.note("Conceptual model for #195; final table and API contracts are not chosen.")
        elif key == "review_flow":
            self.row([("Stable review target", "Server-owned identity/day"), ("Read cached body", "Offline if available"),
                      ("Complete / queue", "Account-scoped intention"), ("Reconcile once", "Server day + deduplication")], 43, 63, 16)
            self.note("PROPOSED #195: two devices and repeated taps share one logical completion.", 139)
            self.note("A fresh lesson arriving now must not replace a review already in progress.", 159)
        elif key == "content_ops":
            self.row([("Supply + job metrics", "Reserve, queue, calls, health"), ("Protected report", "Actionable alerts + recovery"),
                      ("Authorized maintainer", "Review, repair, pause, restore")], 44, 57)
            self.note("PROPOSED #195: report causes, deduplicate alerts and preserve spending limits.", 141)
            self.note("Operator alerts are separate from learner reminders and account emails.", 161)
        else:
            raise ValueError(f"Unknown diagram: {key}")

        # Draw boxes after connectors so lines cannot overprint the labels.
        for _, (x, y, w, h, title, body, tone) in self.nodes.items():
            c.setFillColor(colors.white)
            c.setStrokeColor(LINE)
            c.roundRect(x, self.base_h - y - h, w, h, 5, fill=1, stroke=1)
            accent = AMBER if tone == "amber" else TEAL
            c.setFillColor(accent)
            c.roundRect(x, self.base_h - y - h, 3, h, 1, fill=1, stroke=0)
            st = ParagraphStyle("node", fontName="Body", fontSize=8.2, leading=10.4,
                                textColor=INK, alignment=TA_CENTER)
            tx = "<b>" + html.escape(title) + "</b>"
            if body: tx += '<br/><font size="7.7" color="#5C6F7F">' + html.escape(body) + "</font>"
            p = Paragraph(tx, st)
            _, ph = p.wrap(w - 13, h)
            if ph > h - 5:
                raise ValueError(f"Diagram label overflow in {key}: {title} ({ph} > {h})")
            p.drawOn(c, x + 7, self.base_h - y - (h + ph) / 2)
        c.restoreState()


def blocks(body, scale, fig_start, chapter):
    st = styles(scale)
    lines = body.strip().splitlines()
    result, i, fig = [], 0, fig_start
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("<!-- diagram:"):
            key = re.search(r"diagram: (\w+)", line)[1]
            fig += 1
            result += [Diagram(key, fig, scale), Spacer(1, 6 * scale)]
            i += 1
        elif line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [v.strip() for v in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[: -]+", v) for v in cells): rows.append(cells)
                i += 1
            n = len(rows[0])
            if n == 2: ratios = [.34, .66]
            elif n == 3: ratios = [.29, .28, .43]
            elif n == 4: ratios = [.34, .22, .22, .22]
            else: ratios = [1 / n] * n
            if chapter in {"04", "11"}: ratios = [.28, .22, .50]
            if chapter in {"10", "22"}: ratios = [.34, .32, .34] if n == 3 else [.28, .72]
            if chapter in {"25", "30"}: ratios = [.32, .29, .39]
            if chapter == "33": ratios = [.10, .38, .52]
            if chapter == "35": ratios = [.30, .16, .54]
            if chapter == "42": ratios = [.18, .42, .40]
            if chapter == "38": ratios = [.34, .66]
            def cell_text(value):
                rendered = inline(value)
                if chapter == "10" and value.startswith("EXPO_PUBLIC_"):
                    rendered = rendered.replace("EXPO_PUBLIC_", "EXPO_PUBLIC_<br/>", 1)
                return rendered
            content = [[Paragraph(cell_text(v), st["head"] if r == 0 else st["cell"])
                        for v in row] for r, row in enumerate(rows)]
            table = Table(content, colWidths=[WIDTH * r for r in ratios], hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7 * scale),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7 * scale),
                ("TOPPADDING", (0, 0), (-1, -1), 5.2 * scale),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5.2 * scale),
                ("LINEBELOW", (0, 0), (-1, 0), .5, NAVY),
                ("LINEBELOW", (0, 1), (-1, -1), .3, LINE),
            ]))
            result += [table, Spacer(1, 9 * scale)]
        else:
            para = [line]
            i += 1
            # Keep list items as independent short paragraphs.
            item = bool(re.match(r"(?:\d+\. |\- )", line))
            while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith(("|", "<!--")):
                if item or re.match(r"(?:\d+\. |\- )", lines[i].strip()): break
                para.append(lines[i].strip())
                i += 1
            value = " ".join(para)
            source = value.startswith("Sources:")
            if source: result.append(Spacer(1, 3 * scale))
            p = Paragraph(inline(value), st["source"] if source else st["body"])
            result += [p, Spacer(1, (5 if source else 7) * scale)]
    return result, fig


def footer(c, page, total):
    c.setStrokeColor(LINE)
    c.line(MARGIN, 35, PW - MARGIN, 35)
    c.setFont("Body", 7.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 23, "ONE CONCEPT  /  ENGINEERING HANDBOOK  /  13 SEP 2026")
    c.drawRightString(PW - MARGIN, 23, f"{page:02d} / {total:02d}")


def cover(c, total):
    c.setFillColor(NAVY)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.rect(0, PH - 14, PW, 14, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#91D6D1"))
    c.setFont("Bold", 11)
    c.drawString(48, 749, "THE OWNER'S ENGINEERING HANDBOOK")
    c.setFillColor(colors.white)
    c.setFont("Bold", 48)
    c.drawString(46, 669, "ONE")
    c.drawString(46, 613, "CONCEPT")
    p = Paragraph("Understand the whole app.<br/>From a GitHub commit to a learner's daily habit.",
                  ParagraphStyle("cover", fontName="Body", fontSize=17, leading=25, textColor=colors.white))
    _, h = p.wrap(470, 100)
    p.drawOn(c, 48, 562 - h)
    for i, (title, subtitle) in enumerate([
        (f"{CHAPTERS} chapters", "The current app plus issue #195's sustainable future design"),
        (f"{DIAGRAMS} diagrams", "Identity, lessons, notifications, offline and release flows"),
        ("7-day digest", "Study plan, scenarios and concluding before/after Q&A")]):
        y = 394 - i * 66
        c.setFillColor(colors.HexColor("#24445E"))
        c.roundRect(48, y - 10, 499, 54, 6, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#91D6D1")); c.setFont("Bold", 13)
        c.drawString(62, y + 22, title)
        c.setFillColor(colors.white); c.setFont("Body", 10)
        c.drawString(62, y + 5, subtitle)
    c.setFillColor(colors.white); c.setFont("Bold", 11)
    c.drawString(48, 135, "Muawiya Amir  /  Coding Moves")
    c.setFont("Body", 10); c.setFillColor(colors.HexColor("#BCCDD8"))
    c.drawString(48, 111, "App 1.8.0  |  Native runtime 1.3.0  |  13 September 2026")
    c.drawString(48, 92, "Source-based explanations. Live settings and defaults are distinguished.")
    c.drawString(48, 73, "No secret values. Examples are illustrative, not real learner records.")
    c.bookmarkPage("cover"); c.addOutlineEntry("One Concept engineering handbook", "cover", 0)
    c.showPage()


def contents(c, chapters, total):
    c.bookmarkPage("contents"); c.addOutlineEntry("Contents and reading guide", "contents", 0)
    c.setFillColor(TEAL); c.setFont("Bold", 9)
    c.drawString(MARGIN, PH - 51, "READ, TRACE, EXPLAIN")
    c.setFillColor(NAVY); c.setFont("Bold", 26)
    c.drawString(MARGIN, PH - 85, "Your map through the handbook")
    p = Paragraph("Start with chapters 01-06, then follow the layer that interests you. "
                  "Chapter numbers below are clickable; PDF bookmarks provide the same navigation. "
                  "Chapter 35 turns the handbook into a one-week study plan.", styles()["body"])
    _, h = p.wrap(WIDTH, 70); p.drawOn(c, MARGIN, PH - 102 - h)
    colw = (WIDTH - 24) / 2
    per_column = math.ceil(len(chapters) / 2)
    for i, (num, title, _) in enumerate(chapters):
        col, row = i // per_column, i % per_column
        x, y = MARGIN + col * (colw + 24), PH - 181 - row * 23.8
        c.setFillColor(TEAL); c.setFont("Bold", 9.5)
        c.drawString(x, y, num)
        style = ParagraphStyle("toc", fontName="Body", fontSize=9.1, leading=10.8, textColor=INK)
        p = Paragraph(html.escape(title), style)
        _, th = p.wrap(colw - 47, 26)
        p.drawOn(c, x + 23, y + 8 - th)
        c.setFont("Body", 8); c.setFillColor(MUTED)
        c.drawRightString(x + colw, y, str(int(num) + 2))
        c.linkRect("", "chapter-" + num, (x, y - 13, x + colw, y + 12), relative=0, thickness=0)
    footer(c, 2, total)
    c.showPage()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "output/pdf/one-concept-engineering-handbook.pdf")
    parser.add_argument("--font-dir", type=Path)
    parser.add_argument("--qa-report", type=Path, default=ROOT / "tmp/pdfs/handbook-layout.json")
    args = parser.parse_args()
    fonts(args.font_dir)
    source = (HERE / "ONE_CONCEPT_HANDBOOK.md").read_text()
    parts = re.split(r"^# (\d{2}) \| (.+)\n", source, flags=re.M)
    chapters = [(parts[i], parts[i + 1], parts[i + 2]) for i in range(1, len(parts), 3)]
    if len(chapters) != CHAPTERS: raise ValueError(f"Expected all {CHAPTERS} chapters")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(args.output), pagesize=A4, pageCompression=1)
    c.setTitle("One Concept - Complete Engineering Handbook")
    c.setAuthor("Muawiya Amir")
    c.setSubject("Architecture, daily lessons, generation, notifications, offline state and release operations")
    total = len(chapters) + 2
    cover(c, total)
    contents(c, chapters, total)
    figures, report = 0, []
    for num, title, body in chapters:
        page = int(num) + 2
        c.bookmarkPage("chapter-" + num)
        c.addOutlineEntry(num + "  " + title, "chapter-" + num, 0)
        c.setFillColor(TEAL); c.setFont("Bold", 9)
        c.drawString(MARGIN, PH - 48, f"CHAPTER {num}  /  ONE CONCEPT")
        head = Paragraph(html.escape(title), ParagraphStyle("title", fontName="Bold", fontSize=24,
                                                            leading=27, textColor=NAVY))
        _, hh = head.wrap(WIDTH, 80)
        top = PH - 64
        head.drawOn(c, MARGIN, top - hh)
        top -= hh + 14
        room = top - 48
        for scale in (1, .98, .96, .94, .92, .90, .88):
            flow, final_fig = blocks(body, scale, figures, num)
            sizes = [f.wrap(WIDTH, PH)[1] for f in flow]
            if sum(sizes) <= room: break
        else:
            raise ValueError(f"Chapter {num} overflows: {sum(sizes):.1f}pt for {room:.1f}pt")
        cursor = top
        for f, height in zip(flow, sizes):
            cursor -= height
            f.drawOn(c, MARGIN, cursor)
        figures = final_fig
        footer(c, page, total)
        c.showPage()
        report.append({"chapter": num, "page": page, "scale": scale, "bottom": round(cursor, 1),
                       "body_font": round(10.15 * scale, 2), "table_font": round(9 * scale, 2)})
    if figures != DIAGRAMS: raise ValueError(f"Expected {DIAGRAMS} diagrams, found {figures}")
    c.save()
    args.qa_report.parent.mkdir(parents=True, exist_ok=True)
    args.qa_report.write_text(json.dumps({"pages": total, "diagrams": figures, "chapters": report}, indent=2))
    print(json.dumps({"pdf": str(args.output), "pages": total, "diagrams": figures,
                      "smallest_scale": min(x["scale"] for x in report), "report": str(args.qa_report)}))


if __name__ == "__main__":
    main()
