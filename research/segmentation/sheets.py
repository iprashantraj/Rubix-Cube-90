"""
Contact sheets for the seg-v1 benchmark — the part a human actually decides on.

One row per fixture: the original, then every model's cutout composited on white.
Nothing is scored here. The numbers in metrics.csv tell you where to look; these
sheets tell you what the artisan would see.

Usage:  ai/.venv/bin/python research/segmentation/sheets.py [--group fringe]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "images" / "raw"
OUT = ROOT / "research" / "segmentation" / "out"
SETFILE = Path(__file__).parent / "seg-v1.txt"

CELL = 320
PAD = 10
LABEL_H = 22


def load_groups() -> dict[str, list[str]]:
    """seg-v1.txt's '## ' comments are the group names; use them as sheet names."""
    groups: dict[str, list[str]] = {}
    current = "ungrouped"
    for ln in SETFILE.read_text().splitlines():
        s = ln.strip()
        if s.startswith("## "):
            current = s[3:].split("—")[0].strip().replace(" ", "-")
            groups.setdefault(current, [])
        elif s and not s.startswith("#"):
            groups.setdefault(current, []).append(s)
    return groups


def font(sz=13):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def fit(im: Image.Image, cell: int) -> Image.Image:
    im = im.copy()
    im.thumbnail((cell, cell), Image.LANCZOS)
    canvas = Image.new("RGB", (cell, cell), (245, 245, 245))
    canvas.paste(im, ((cell - im.width) // 2, (cell - im.height) // 2))
    return canvas


def build(group: str, names: list[str], models: list[str]) -> Path | None:
    rows = [n for n in names if (RAW / n).exists()]
    if not rows:
        return None
    cols = 1 + len(models)
    W = cols * (CELL + PAD) + PAD
    H = LABEL_H + PAD + len(rows) * (CELL + LABEL_H + PAD)
    sheet = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(sheet)
    f, fb = font(13), font(15)

    for c, title in enumerate(["original"] + models):
        d.text((PAD + c * (CELL + PAD), 4), title, fill="black", font=fb)

    for r, name in enumerate(rows):
        y = LABEL_H + PAD + r * (CELL + LABEL_H + PAD)
        d.text((PAD, y - 2), name, fill=(90, 90, 90), font=f)
        sheet.paste(fit(Image.open(RAW / name).convert("RGB"), CELL), (PAD, y + LABEL_H - 4))
        stem = Path(name).stem
        for c, m in enumerate(models, start=1):
            p = OUT / m / "cutout" / f"{stem}.png"
            x = PAD + c * (CELL + PAD)
            if p.exists():
                sheet.paste(fit(Image.open(p).convert("RGB"), CELL), (x, y + LABEL_H - 4))
            else:
                d.rectangle([x, y + LABEL_H - 4, x + CELL, y + LABEL_H - 4 + CELL],
                            outline=(200, 200, 200))
                d.text((x + 8, y + LABEL_H + CELL // 2), "(no output)",
                       fill=(160, 160, 160), font=f)

    dest = OUT / f"sheet-{group}.png"
    sheet.save(dest)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default=None, help="only this group")
    ap.add_argument("--models", default=None, help="comma list; default = every out/ dir found")
    args = ap.parse_args()

    models = ([m.strip() for m in args.models.split(",")] if args.models
              else sorted(p.name for p in OUT.iterdir() if (p / "cutout").is_dir()))
    if not models:
        raise SystemExit(f"no model outputs under {OUT} — run bench.py first")

    groups = load_groups()
    for g, names in groups.items():
        if args.group and g != args.group:
            continue
        dest = build(g, names, models)
        if dest:
            print(f"{dest}  ({len(names)} images x {len(models)} models)")


if __name__ == "__main__":
    main()
