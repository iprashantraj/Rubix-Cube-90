"""The government lane, as one flow instead of a fan-out.

The finalised problem statement says the government already PROVIDES the trade fairs. The
money is spent; what it cannot see is whether the spend turned into continuous business. So
the dashboard is not a wall of analytics modules — it is one question asked six times:

    of the artisans we put in front of buyers, how many are still selling, and where did the
    rest stop?

That is a funnel, and a funnel is a single spine. Every box has exactly one arrow out.

The structural idea worth keeping: each government box sits at the SAME HEIGHT as the seller
step it measures, joined by one dashed line. The government lane is the seller lane, counted.
Nothing on the right exists that is not a count of something on the left, which is also why
it needs no new instrumentation — every number is a query over rows the app already writes.

Run: python3 docs/diagrams/make_govt_flow.py
"""

from __future__ import annotations

from pathlib import Path

W, H = 1560, 1080
OUT = Path(__file__).parent

INK = "#1f2933"
MUTED = "#7b8794"
LINE = "#b9c2cc"
SELL = "#c2410c"
SELL_BG = "#fff1e7"
GOV = "#5b21b6"
GOV_BG = "#f4f0ff"
DROP = "#b91c1c"
DROP_BG = "#fef2f2"
COOL = "#0f766e"
COOL_BG = "#effcfa"
PAPER = "#ffffff"

svg: list[str] = []
add = svg.append


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=15, fill=INK, weight="400", anchor="start", spacing="0"):
    add(
        f'<text x="{x}" y="{y}" font-family="Inter, Segoe UI, system-ui, sans-serif" '
        f'font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}" '
        f'letter-spacing="{spacing}">{esc(s)}</text>'
    )


def box(x, y, w, h, stroke=LINE, fill=PAPER, dash=None, r=10, sw=1.6):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{sw}"{d}/>')


def down(x, y1, y2, stroke=LINE):
    add(f'<path d="M {x} {y1} L {x} {y2}" stroke="{stroke}" stroke-width="2" fill="none" '
        f'marker-end="url(#a)"/>')


def dashed(x1, y, x2, stroke=LINE):
    add(f'<path d="M {x1} {y} L {x2} {y}" stroke="{stroke}" stroke-width="1.5" fill="none" '
        f'stroke-dasharray="5 5" marker-end="url(#b)"/>')


add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add('<defs>'
    f'<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" '
    f'orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="{LINE}"/></marker>'
    f'<marker id="b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" '
    f'orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="{LINE}"/></marker>'
    '</defs>')
add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')

text(48, 52, "The government sees the same journey — counted", 24, INK, "600")
text(48, 78, "Every box on the right is a count of the box on its left. One question, asked "
             "six times: where did they stop?", 14, MUTED)

# lane headers
box(150, 106, 320, 46, stroke=SELL, fill=SELL_BG, r=8, sw=2)
text(310, 135, "SELLER / ARTISAN", 14, SELL, "700", "middle", "1.2")
box(880, 106, 460, 46, stroke=GOV, fill=GOV_BG, r=8, sw=2)
text(1110, 135, "GOVERNMENT", 14, GOV, "700", "middle", "1.2")

# Six paired rows. Left = what the artisan does, right = what the state can therefore count,
# and the number that matters when it does not happen.
rows = [
    ("Registers", "signs up, names their craft",
     "How many onboarded", "of everyone the agency invited"),
    ("Photographs the product", "phone coaches the shot",
     "How many got past the camera", "the first place people quietly stop"),
    ("Describes it by voice", "own language, no typing",
     "How many completed a listing", "products digitised, the real output"),
    ("Sets a fair price", "cost floor, not a guess",
     "How many priced above cost", "exposure that pays, not just exposure"),
    ("Publishes", "GeM · ONDC · marketplaces",
     "How many reached a channel", "and which channel took them"),
    ("Gets paid", "order settles",
     "How many were actually paid", "the only number that proves it worked"),
]

y0, pitch = 178, 122
for i, (a, b, c, d) in enumerate(rows):
    y = y0 + i * pitch

    box(150, y, 320, 76, stroke=SELL, fill=SELL_BG, sw=1.8)
    text(170, y + 31, f"{i + 1}.  {a}", 15, INK, "600")
    text(170, y + 53, b, 12.5, MUTED)

    box(880, y, 460, 76, stroke=GOV, fill=GOV_BG, sw=1.8)
    text(900, y + 31, c, 15, INK, "600")
    text(900, y + 53, d, 12.5, MUTED)

    # one dashed line per row: "this measures that". Not a fan-out.
    dashed(470, y + 38, 872)

    # the drop between this step and the next, which is the entire point
    if i < len(rows) - 1:
        down(310, y + 76, y + pitch)
        down(1110, y + 76, y + pitch)
        box(556, y + 84, 232, 30, stroke=DROP, fill=DROP_BG, r=8, sw=1.4, dash="4 3")
        text(672, y + 104, "who fell out here", 12, DROP, "600", "middle")

# the one output an official actually acts on
last = y0 + (len(rows) - 1) * pitch + 76
down(1110, last, last + 44)
box(880, last + 44, 460, 78, stroke=GOV, fill=PAPER, sw=2)
text(1110, last + 74, "WHERE TO INTERVENE NEXT", 14, GOV, "700", "middle", "1")
text(1110, last + 96, "the step, the district, the craft — and a report to export", 12.5,
     MUTED, anchor="middle")

# shared database, drawn once, under both
box(150, last + 44, 460, 78, stroke=COOL, fill=COOL_BG, sw=2)
text(380, last + 74, "ONE SHARED DATABASE", 14, COOL, "700", "middle", "1")
text(380, last + 96, "no new tracking — these are queries over rows the app already writes",
     12.5, MUTED, anchor="middle")
down(310, last, last + 44)

add("</svg>")
(OUT / "govt-flow.svg").write_text("\n".join(svg), encoding="utf-8")
print("wrote govt-flow.svg")
