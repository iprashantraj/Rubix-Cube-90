"""Draw the one-page picture of what this application is.

Deliberately abstract. Somebody who has never seen the repo should be able to look at this
for thirty seconds and know what exists, what does not, and who each part is for. No API
names, no file paths, no tiers of implementation detail — those live in
docs/Application-Architecture.md and are the wrong altitude for this.

The one thing it is strict about is honesty: solid means built and running today, dashed
means decided but not written. A diagram that draws the plan and the product in the same
weight is how a demo promises something that does not exist.

Outputs, both into docs/diagrams/:
    application-overview.svg          the picture
    application-overview.excalidraw   the same thing, editable at excalidraw.com

Run: python3 docs/diagrams/make_overview.py
"""

from __future__ import annotations

import json
from pathlib import Path

W, H = 1680, 1310
OUT = Path(__file__).parent

# A quiet palette. The artisan side is warm (terracotta, the material most of them work in),
# the government side is cool, and nothing is saturated enough to fight the text.
INK = "#1f2933"
MUTED = "#7b8794"
LINE = "#cbd2d9"
WARM = "#b45309"
WARM_BG = "#fff7ed"
COOL = "#0f766e"
COOL_BG = "#f0fdfa"
PLAN = "#9aa5b1"
PLAN_BG = "#fafbfc"
PAPER = "#ffffff"

svg: list[str] = []
add = svg.append


def text(x, y, s, size=15, fill=INK, weight="400", anchor="start", spacing="0"):
    # Escaped here rather than at every call site. A bare "&" in a label — "OFFICIALS &
    # AGENCIES" — is not valid XML, and the failure is a browser refusing to render the
    # whole file rather than one broken glyph.
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    add(
        f'<text x="{x}" y="{y}" font-family="Inter, Segoe UI, system-ui, sans-serif" '
        f'font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}" '
        f'letter-spacing="{spacing}">{s}</text>'
    )


def box(x, y, w, h, stroke=LINE, fill=PAPER, dash=None, r=14, sw=1.6):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    add(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{sw}"{d}/>'
    )


def chip(x, y, w, label, sub=None, stroke=LINE, fill=PAPER, dash=None, h=54):
    box(x, y, w, h, stroke=stroke, fill=fill, dash=dash, r=10, sw=1.4)
    text(x + 16, y + (25 if sub else 33), label, 14.5, INK, "500")
    if sub:
        text(x + 16, y + 42, sub, 12, MUTED)


def arrow(x1, y1, x2, y2, stroke=LINE, dash=None, head=True):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    marker = ' marker-end="url(#a)"' if head else ""
    add(
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{stroke}" stroke-width="1.6" '
        f'fill="none"{d}{marker}/>'
    )


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add(
    '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
    f'markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="{LINE}"/>'
    "</marker></defs>"
)
add(f'<rect width="{W}" height="{H}" fill="#fbfcfd"/>')

# ── header ────────────────────────────────────────────────────────────────────────────
text(64, 68, "Kaarigar", 30, INK, "600")
text(64, 96, "A craftsperson photographs what they made, says a few words about it, and it "
             "is listed for sale.", 15, MUTED)

# Legend, top right, because the solid/dashed distinction is the point of the whole picture.
box(1216, 44, 400, 62, stroke=LINE, fill=PAPER, r=10, sw=1.2)
add(f'<rect x="1236" y="66" width="26" height="14" rx="4" fill="{PAPER}" stroke="{INK}" stroke-width="1.6"/>')
text(1272, 78, "built and running", 13, INK)
add(f'<rect x="1400" y="66" width="26" height="14" rx="4" fill="{PLAN_BG}" stroke="{PLAN}" '
    f'stroke-width="1.6" stroke-dasharray="5 4"/>')
text(1436, 78, "planned", 13, MUTED)

# ── entry ─────────────────────────────────────────────────────────────────────────────
box(636, 146, 408, 84, stroke=INK, fill=PAPER, r=12, sw=1.8)
text(840, 178, "WHO ARE YOU?", 15, INK, "600", "middle", "1.2")
text(840, 202, "on a phone → artisan   ·   in a browser → officials", 12.5, MUTED, anchor="middle")

arrow(700, 230, 420, 292)
arrow(980, 230, 1262, 292)

# ── artisan side ──────────────────────────────────────────────────────────────────────
box(64, 292, 700, 540, stroke=WARM, fill=WARM_BG, r=18, sw=1.8)
text(96, 330, "THE ARTISAN", 13, WARM, "700", spacing="1.6")
text(96, 356, "Mobile app · voice-first · works for someone who cannot read", 13, MUTED)

steps = [
    ("1  Sign up", "phone number, and what they make"),
    ("2  Photograph it", "the phone coaches the shot"),
    ("3  Tidy the photo", "background removed, never invented"),
    ("4  Say what it is", "a few spoken questions, in their language"),
    ("5  See a fair price", "warns them before they sell at a loss"),
    ("6  Send it out", "one press, every marketplace at once"),
]
for i, (a, b) in enumerate(steps):
    chip(96, 384 + i * 60, 636, a, b, stroke="#e7d4bd", fill=PAPER)
    if i < len(steps) - 1:
        arrow(414, 384 + i * 60 + 54, 414, 384 + (i + 1) * 60, stroke="#e0d3c2", head=False)

# ── government side ───────────────────────────────────────────────────────────────────
box(916, 292, 700, 540, stroke=PLAN, fill=PLAN_BG, r=18, sw=1.8, dash="7 6")
text(948, 330, "OFFICIALS & ONBOARDING AGENCIES", 13, PLAN, "700", spacing="1.6")
text(948, 356, "A separate website. Nothing here is built yet.", 13, MUTED)

# Ordered by consequence, not by how easy the chart is. The first two are the ones an
# official can act on; the rest are counts.
tiles = [
    # The sharpest gap on the page. Everything else measures activity — this measures
    # whether the thing worked. An artisan who listed, sold and was never paid is a worse
    # outcome than one who never listed at all.
    ("Did the money arrive", "settlement delays, paid or not"),
    # Not "where people give up". An AGENCY onboards a thousand and fifty make it; the
    # other 950 are invisible, and nobody can say which step stopped them.
    ("Why 950 of 1,000 dropped", "the exact step they gave up at"),
    ("Which sellers are stuck", "and what they are stuck on"),
    ("How many joined", "and who they are"),
    ("How many products listed", "the actual output"),
    ("Who is still selling", "active, not just signed up"),
    ("Which regions work", "and which need help"),
    ("Which crafts sell", "by trade"),
    ("Which marketplace pays", "Amazon, GeM, or elsewhere"),
]
for i, (a, b) in enumerate(tiles):
    col, row = i % 2, i // 2
    chip(948 + col * 336, 384 + row * 62, 316, a, b, stroke=PLAN, fill=PAPER, dash="5 4", h=52)

box(948, 762, 652, 52, stroke="#e3b7b7", fill="#fff5f5", r=10, sw=1.4)
text(964, 784, "An agency onboards 1,000 artisans. Fifty reach a live listing.", 12.5, "#9b2c2c", "600")
text(964, 802, "Nobody can say what stopped the other 950 — that is what this side is for.",
     12, MUTED)

# ── shared database ───────────────────────────────────────────────────────────────────
# A strip under both panels, not a box between them: the gap is 152px wide and anything
# legible placed in it overlapped a tile on one side or the other.
arrow(414, 832, 414, 862, stroke=COOL, head=False)
arrow(1266, 832, 1266, 862, stroke=COOL, dash="5 4", head=False)
box(64, 862, 1552, 62, stroke=COOL, fill=COOL_BG, r=12, sw=1.8)
text(840, 890, "ONE SHARED DATABASE", 13.5, COOL, "700", "middle", "0.8")
text(840, 910, "the app writes it, the dashboard reads it — both sides see the same truth",
     12, MUTED, anchor="middle")

# ── where it goes ─────────────────────────────────────────────────────────────────────
text(64, 986, "WHERE THE PRODUCT ACTUALLY GOES", 13, INK, "700", spacing="1.4")
text(64, 1010, "Not all the same. What each one costs the artisan is different, and the app "
              "says so before they press anything.", 13, MUTED)

channels = [
    ("Our own shop", "live now", False),
    ("ONDC", "no paperwork for them", False),
    ("GeM", "we make the file", False),
    ("Amazon", "needs their account", True),
    ("Flipkart", "needs their account", True),
    ("Meesho", "guided, by hand", True),
    ("WhatsApp", "photo + caption", False),
]
for i, (a, b, planned) in enumerate(channels):
    x = 64 + i * 224
    chip(x, 1038, 208, a, b, stroke=PLAN if planned else "#cfe3df",
         fill=PAPER, dash="5 4" if planned else None, h=58)

text(64, 1150, "Not built yet: a place for buyers to browse.  ·  "
               "Myntra is out — it will not accept an unbranded artisan at all.", 13, MUTED)

# ── the honest footer ─────────────────────────────────────────────────────────────────
box(64, 1180, 1552, 84, stroke=LINE, fill=PAPER, r=12, sw=1.2)
text(88, 1210, "The rule the whole thing is built on", 13, INK, "700")
text(88, 1234, "The photograph is cleaned, never invented. The price warns before it "
               "flatters. Nothing is published until the artisan has confirmed the colour "
               "with their own eyes.", 13, MUTED)

add("</svg>")
(OUT / "application-overview.svg").write_text("\n".join(svg), encoding="utf-8")

# ── the editable version ──────────────────────────────────────────────────────────────
# Excalidraw's format is plain JSON. Only rectangles and text are needed, and emitting them
# directly keeps this dependency-free — the file opens at excalidraw.com for anyone who
# wants to move a box.
els: list[dict] = []
seed = 1


def ex_rect(x, y, w, h, stroke=INK, bg="transparent", dashed=False):
    global seed
    seed += 1
    els.append({
        "type": "rectangle", "id": f"r{seed}", "x": x, "y": y, "width": w, "height": h,
        "angle": 0, "strokeColor": stroke, "backgroundColor": bg, "fillStyle": "solid",
        "strokeWidth": 2, "strokeStyle": "dashed" if dashed else "solid", "roughness": 1,
        "opacity": 100, "seed": seed, "version": 1, "versionNonce": seed, "isDeleted": False,
        "groupIds": [], "roundness": {"type": 3}, "boundElements": [], "updated": 1,
        "link": None, "locked": False,
    })


def ex_text(x, y, s, size=16, color=INK):
    global seed
    seed += 1
    els.append({
        "type": "text", "id": f"t{seed}", "x": x, "y": y, "width": max(10, len(s) * size * 0.55),
        "height": size * 1.25, "angle": 0, "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid", "roughness": 1,
        "opacity": 100, "seed": seed, "version": 1, "versionNonce": seed, "isDeleted": False,
        "groupIds": [], "roundness": None, "boundElements": [], "updated": 1, "link": None,
        "locked": False, "text": s, "fontSize": size, "fontFamily": 2, "textAlign": "left",
        "verticalAlign": "top", "containerId": None, "originalText": s, "lineHeight": 1.25,
    })


ex_text(64, 40, "Kaarigar — what the application is", 28)
ex_text(64, 84, "solid = built today.  dashed = planned, not written.", 16, MUTED)

ex_rect(636, 146, 408, 84)
ex_text(700, 178, "WHO ARE YOU?  phone -> artisan, browser -> officials", 16)

ex_rect(64, 292, 700, 470, WARM, WARM_BG)
ex_text(96, 320, "THE ARTISAN  (mobile app, voice-first)", 18, WARM)
for i, (a, b) in enumerate(steps):
    ex_rect(96, 384 + i * 60, 636, 54)
    ex_text(112, 398 + i * 60, f"{a} — {b}", 15)

ex_rect(916, 292, 700, 470, PLAN, PLAN_BG, dashed=True)
ex_text(948, 320, "OFFICIALS & AGENCIES  (separate website, not built)", 18, PLAN)
for i, (a, b) in enumerate(tiles):
    col, row = i % 2, i // 2
    ex_rect(948 + col * 336, 384 + row * 62, 316, 52, PLAN, dashed=True)
    ex_text(964 + col * 336, 396 + row * 62, a, 14, INK)

ex_rect(64, 862, 1552, 62, COOL, COOL_BG)
ex_text(700, 880, "ONE SHARED DATABASE", 16, COOL)

ex_text(64, 986, "WHERE THE PRODUCT GOES", 18)
for i, (a, b, planned) in enumerate(channels):
    ex_rect(64 + i * 224, 1038, 208, 58, PLAN if planned else INK, dashed=planned)
    ex_text(80 + i * 224, 1054, a, 14)

(OUT / "application-overview.excalidraw").write_text(
    json.dumps({"type": "excalidraw", "version": 2, "source": "kaarigar",
                "elements": els, "appState": {"viewBackgroundColor": "#fbfcfd"},
                "files": {}}, indent=1),
    encoding="utf-8",
)

print("wrote application-overview.svg and application-overview.excalidraw")
