"""Make the bad fixtures, because the web does not have any.

    python3 images/degrade.py --dry-run
    python3 images/degrade.py                    # all kinds, every clean fixture
    python3 images/degrade.py --kind motion underexposed
    python3 images/degrade.py --fill-gaps        # only what is missing or unreadable

The `bad` half of the fixture set cannot be scraped. Nobody publishes their failures: every
image on Google, Wikimedia, Flickr or an e-commerce listing has already survived somebody
deciding it was good enough to upload. Searching harder does not find what was never posted.

So we make them, from the clean fixtures, with the degradation parameters recorded. That is
better than a found bad photo in one specific way that matters here: **we know the ground
truth.** "This image is 3.1 stops under" is a fact, not a guess, so when the gate rejects it
we know whether it rejected it for the right reason.

⚠️ What this is and is not valid for.

Valid: calibrating the gate thresholds. The gate measures four things — Laplacian variance,
histogram mean, clipped-highlight fraction, crushed-shadow fraction — and every one of them
is a luma statistic that a synthetic degradation reproduces faithfully.

Not valid: judging `denoise_sharpen()`. A synthetically darkened image has clean shadows; a
genuinely underexposed sensor capture has read noise and chroma blotching in exactly those
shadows. Do not tune denoising on these. That needs a real phone in real bad light — the
one part of `gate-v1` with no substitute.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
MANIFEST = ROOT / "MANIFEST.md"

MIN_SOURCE_PX = 1000  # degrading a thumbnail produces a smaller thumbnail, not a fixture


# Bands of rows, for the same reason check.py uses them: the first version of motion()
# held four float64 copies of the whole image plus one temporary per shift, which is ~2GB
# on a 12MP source and is what killed a session on a machine with no swap. A horizontal
# smear makes rows independent, so a band is exactly equivalent to the whole array — the
# arithmetic below is unchanged, it just runs on 256 rows at a time.
BAND_ROWS = 256


def motion(img: Image.Image, px: int = 24) -> tuple[Image.Image, str]:
    """Hand shake during exposure: the frame smeared along one axis.

    Averaging shifted copies rather than convolving with a kernel — same result for a
    straight-line smear, no scipy, and the length is legible in the parameter.
    """
    src = np.asarray(img.convert("RGB"))
    out = np.empty_like(src)
    for top in range(0, src.shape[0], BAND_ROWS):
        band = src[top:top + BAND_ROWS].astype(np.float64)
        # Edge-replicate before smearing, so the wrap artefact lands in the padding and the
        # fixture comes back at its original size. Cropping instead used to push a 1024px
        # source under resolution_min_px, which made the fixture fail for the wrong reason.
        pad = np.pad(band, ((0, 0), (px, px), (0, 0)), mode="edge")
        acc = np.zeros_like(pad)
        for d in range(px):
            acc += np.roll(pad, d - px // 2, axis=1)
        out[top:top + BAND_ROWS] = np.clip(acc / px, 0, 255).astype(np.uint8)[:, px:-px]
    return Image.fromarray(out), f"horizontal smear {px}px"


def defocus(img: Image.Image, radius: float = 6.0) -> tuple[Image.Image, str]:
    """Autofocus missed. Different from motion blur: isotropic, no direction."""
    return img.convert("RGB").filter(ImageFilter.GaussianBlur(radius)), f"gaussian blur r={radius}"


def _exposure_lut(stops: float) -> list[int]:
    """Both exposure changes are pointwise functions of one stored byte, so the whole
    transform fits in 256 entries. Identical output to running the arithmetic over every
    pixel — same float64 ops, same clip, same truncation — for a thousandth of the memory.
    """
    v = np.arange(256, dtype=np.float64) / 255.0
    lin = np.power(v, 2.2) * (2.0 ** stops)
    return np.clip(np.power(np.clip(lin, 0, 1), 1 / 2.2) * 255, 0, 255).astype(np.uint8).tolist()


def underexposed(img: Image.Image, stops: float = 3.0) -> tuple[Image.Image, str]:
    """Indoors, one bulb, no flash. Scaling in linear light, not on the sRGB values —
    halving a stored byte is not halving the light that hit the sensor, and the histogram
    the gate reads would be wrong in the direction that matters."""
    rgb = img.convert("RGB")
    return rgb.point(_exposure_lut(-stops) * 3), f"-{stops} stops in linear light"


def overexposed(img: Image.Image, stops: float = 2.0) -> tuple[Image.Image, str]:
    """Direct midday sun. The point is the clipping: once a highlight reaches 255 the detail
    is physically gone and no server stage recovers it, which is why the gate refuses."""
    rgb = img.convert("RGB")
    return rgb.point(_exposure_lut(stops) * 3), f"+{stops} stops, highlights clipped"


def off_centre(img: Image.Image, shift: float = 0.28) -> tuple[Image.Image, str]:
    """Product pushed towards a corner. Drives center_offset_max.

    The subject has to shrink as well as move, or there is no background for it to be
    off-centre *within* — sliding a full-bleed image just crops it, the busy box still
    spans the frame, and the fixture demonstrates nothing. That was the first version.
    """
    w, h = img.size
    small = img.convert("RGB").resize((int(w * 0.72), int(h * 0.72)), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), (140, 140, 140))
    cx, cy = (w - small.width) // 2, (h - small.height) // 2
    canvas.paste(small, (cx + int(w * shift), cy + int(h * shift * 0.5)))
    return canvas, f"subject at 0.72 scale, offset {shift:.2f} of the frame"


def too_far(img: Image.Image, scale: float = 0.32) -> tuple[Image.Image, str]:
    """Photographed from across the room. Drives fill_fraction_min, and it is the case that
    forces crop() to upscale — a 2000px listing image that looks soft."""
    w, h = img.size
    small = img.convert("RGB").resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), (140, 140, 140))
    canvas.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return canvas, f"subject at {scale:.2f} of frame"


KINDS = {
    "motion": motion,
    "defocus": defocus,
    "underexposed": underexposed,
    "overexposed": overexposed,
    "offcentre": off_centre,
    "toofar": too_far,
}


def base_name(stem: str) -> str:
    """`pottery-terracotta-darkfloor-01` -> `pottery-terracotta`. The condition is replaced
    by `bad`, so check.py counts it under the condition it actually now demonstrates."""
    parts = stem.split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else stem


def fixture_name(base: str, index: int, kind: str) -> str:
    """The name a complete run would have given this (source, kind) pair.

    A full run walks the sources in sorted order and numbers each base group as it goes, so
    the nth source with a given base always produces `<base>-bad-<kind>-<nn>`. Making that
    explicit is what lets --fill-gaps tell a fixture that was never made from one that was.
    """
    return f"{base}-bad-{kind}-{index:02d}.jpg"


def param_of(kind: str) -> str:
    """The parameter string for a kind, without touching a real image. Every degradation's
    parameters are fixed constants, so a 64px dummy reports the same string the real run
    recorded — which is what lets a manifest row be rebuilt for a fixture already on disk."""
    return KINDS[kind](Image.new("RGB", (64, 64), (128, 128, 128)))[1]


def readable(path: Path) -> bool:
    """A fixture that half-wrote before a crash is worse than one that is absent: it looks
    present, and check.py reports it as unreadable 200 lines into a table nobody re-reads."""
    try:
        with Image.open(path) as im:
            im.load()
        return True
    except Exception:
        return False


def manifest_rows() -> set[str]:
    """Fixture names already recorded, so a gap-fill run never writes a row twice."""
    if not MANIFEST.exists():
        return set()
    return {
        line.split("`")[1]
        for line in MANIFEST.read_text().splitlines()
        if line.startswith("| `")
    }


def sources() -> list[Path]:
    out = []
    for p in sorted(RAW.iterdir()):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        if "-bad-" in p.name:
            continue  # never degrade a degraded file
        try:
            with Image.open(p) as im:
                if min(im.size) >= MIN_SOURCE_PX:
                    out.append(p)
        except Exception:
            continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", nargs="*", choices=sorted(KINDS), default=sorted(KINDS))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fill-gaps", action="store_true",
                    help="only make fixtures that are missing or unreadable, and backfill "
                         "manifest rows for the ones already on disk")
    args = ap.parse_args()

    srcs = sources()
    if not srcs:
        print(f"No clean fixtures at {MIN_SOURCE_PX}px or better in {RAW}.")
        print("Degrading a thumbnail produces a smaller thumbnail, not a fixture.")
        print("Fetch some first: python3 images/fetch.py --preset fringe")
        return 1

    print(f"{len(srcs)} source images x {len(args.kind)} kinds = {len(srcs) * len(args.kind)} fixtures\n")

    # Index each source within its base group, in the same order a full run would walk them.
    index: dict[Path, int] = {}
    seen: dict[str, int] = {}
    for src in srcs:
        b = base_name(src.stem)
        seen[b] = seen.get(b, 0) + 1
        index[src] = seen[b]

    recorded = manifest_rows()
    written = backfilled = skipped = 0

    def row(name: str, src: Path, kind: str, param: str) -> str:
        return (f"| `{name}` | {base_name(src.stem)} | bad/{kind} | synthetic | degrade.py | "
                f"n/a — derived from `{src.name}` | {param} |\n")

    # Appended per fixture rather than in one write at the end. The end is exactly what a
    # crash never reaches: an interrupted run once left 128 fixtures on disk with not one
    # manifest row to say where any of them came from.
    sink = None if args.dry_run else MANIFEST.open("a")
    try:
        for src in srcs:
            base, idx = base_name(src.stem), index[src]
            todo = []
            for kind in args.kind:
                name = fixture_name(base, idx, kind)
                if args.fill_gaps and (RAW / name).exists() and readable(RAW / name):
                    if name not in recorded:
                        if not args.dry_run:
                            sink.write(row(name, src, kind, param_of(kind)))
                            sink.flush()
                        recorded.add(name)
                        backfilled += 1
                    skipped += 1
                    continue
                todo.append((name, kind))
            if not todo:
                continue

            with Image.open(src) as im:
                im.load()
                for name, kind in todo:
                    out, param = KINDS[kind](im)
                    print(f"  {name:<48} {param}   <- {src.name}")
                    if args.dry_run:
                        written += 1
                        continue
                    # q92 matches the app's own capture and stripExif encode, so the fixture
                    # carries the same compression the real path produces.
                    out.save(RAW / name, quality=92)
                    del out
                    if name not in recorded:
                        sink.write(row(name, src, kind, param))
                        sink.flush()
                        recorded.add(name)
                    written += 1
    finally:
        if sink:
            sink.close()

    print(f"\n{written} fixtures {'would be ' if args.dry_run else ''}written, "
          f"{skipped} already present"
          + (f", {backfilled} manifest rows backfilled" if backfilled else "") + ".")
    if written and not args.dry_run:
        print("Run `python3 images/check.py --resume` — every one of these should be rejected.")
        print("A synthetic bad photo the gate ACCEPTS is a threshold that is too loose.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
