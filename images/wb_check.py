"""Does white balance help, and by how much? Answers `wb_max_gain_ratio`.

    python3 images/wb_check.py                 # the current number
    python3 images/wb_check.py --sweep         # the curve behind it

`check.py` and `calibrate.py` answer the gate the same way, and this file exists for the
same reason: `ai/thresholds.json` says no number moves without a measurement.

**The ground truth is synthetic, and that is a real limitation, stated up front.** A known
cast is applied to a fixture, the stage is asked to undo it, and the error is how far the
result's mean chroma lands from the untouched original's. That measures whether the *method*
recovers a *known* illuminant. It does not measure whether the method is right about a real
tungsten bulb in a real workshop, because `images/raw` contains no photograph where the true
illuminant is recorded. `images/MANIFEST.md` declares `wb-v1` — the same object shot with and
without a sheet of white paper — for exactly that, and it is still empty. Until it is shot,
this file bounds the method's error and cannot confirm its accuracy.

Mean chroma is the yardstick because it is what the artisan sees go wrong: a cast raises it,
an over-correction strips it, and the untouched original is the number both should land on.

**`--control DIR` is the other half, and it is the half that was missing.** The sweep above
can only ever reward correcting, because every image it scores has been given a cast that
wants undoing. It never asks the opposite question: handed a photograph that is *already
right*, does the stage leave it alone? Control mode applies no cast and measures what the
stage does anyway. The correct answer is nothing.

That distinction is not academic. It is the difference between warm light and a warm object,
and no reference-free method can tell them apart: brass really is gold, and undyed cotton
really is cream. Run control mode on any set of real photographs before trusting a number
this file prints.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ai"))

from enhance import colour, metrics, pipeline, renderer  # noqa: E402

# Warm, and not extreme: a 1.53 channel ratio is an ordinary indoor bulb, not a stress test.
# `--cast r,g,b` overrides it: the optimum cap would otherwise be partly an artefact of one
# chosen cast strength, and a number that only holds for one cast is not a calibration.
CAST = np.array([1.22, 1.0, 0.80], np.float32)
for _i, _a in enumerate(sys.argv):
    if _a == "--cast":
        CAST = np.array([float(v) for v in sys.argv[_i + 1].split(",")], np.float32)
LONG_EDGE = 700  # an illuminant is a property of the light, not of fine detail


def mean_chroma(img: Image.Image) -> float:
    lab = colour.to_lab(np.asarray(img.convert("RGB")))
    return float(np.hypot(lab[..., 1], lab[..., 2]).mean())


def fixtures(limit=None):
    raw = HERE / "raw"
    if not raw.exists():
        return []
    # Indoor first: they are the photographs the stage exists for.
    names = sorted(raw.glob("*indoor*.jpg")) + sorted(raw.glob("*-01.jpg"))
    seen, out = set(), []
    for f in names:
        if f.name in seen:
            continue
        seen.add(f.name)
        out.append(f)
    return out[:limit] if limit else out


def score(cap: float, files) -> dict:
    """Error with the stage, against error with no stage at all."""
    t = dict(metrics.thresholds())
    t["wb_max_gain_ratio"] = cap
    original = pipeline.metrics.thresholds
    pipeline.metrics.thresholds = lambda: t
    try:
        with_wb, without, declined, rows = [], [], 0, []
        for f in files:
            src = Image.open(f).convert("RGB")
            src.thumbnail((LONG_EDGE, LONG_EDGE))
            cast = Image.fromarray(
                np.clip(np.asarray(src, np.float32) * CAST, 0, 255).astype(np.uint8))
            true_c, cast_c = mean_chroma(src), mean_chroma(cast)

            params = pipeline.white_balance(cast)
            if params is None:
                declined += 1
                rows.append((f.name, true_c, cast_c, None, None))
                continue
            out_c = mean_chroma(renderer._apply_white_balance(cast, params))
            with_wb.append(abs(out_c - true_c))
            without.append(abs(cast_c - true_c))
            rows.append((f.name, true_c, cast_c, out_c, params["ratio"]))
        return {"cap": cap, "n": len(with_wb), "declined": declined, "rows": rows,
                "with": float(np.mean(with_wb)) if with_wb else float("nan"),
                "without": float(np.mean(without)) if without else float("nan"),
                "worse": sum(1 for a, b in zip(with_wb, without) if a > b)}
    finally:
        pipeline.metrics.thresholds = original


def hue_of(img: Image.Image) -> float:
    """Median hue angle over the coloured pixels, in degrees. Median, and only where there is
    chroma to have an angle: the hue of a grey pixel is noise, and averaging noise in with
    signal would hide exactly the shift we are looking for."""
    lab = colour.to_lab(np.asarray(img.convert("RGB")))
    c = np.hypot(lab[..., 1], lab[..., 2])
    keep = c > 8
    if not keep.any():
        return float("nan")
    return float(np.median(np.degrees(np.arctan2(lab[..., 2][keep], lab[..., 1][keep]))))


# What counts as damage. Both are "a person would see this", not statistics: a few degrees of
# hue is the boundary between the same colour and a neighbouring one, and losing a sixth of a
# product's chroma is the difference between gold and pewter.
HUE_DEGREES_MAX = 5.0
CHROMA_LOSS_MAX = 0.15


def product_mask(img: Image.Image):
    """The product's own pixels, or None when the model is not installed here.

    **Measuring the whole frame hides the damage this mode exists to find.** A dhokra figure
    on a blue cloth is mostly blue cloth: the brass can lose half its chroma while the frame
    average moves 0.1, and the whole-frame reading calls that fine. Measured on
    `dhokra-ganesha-01`, product chroma fell 13.2 to 5.9 while the frame said 55.0 to 58.3.

    Median hue over a whole frame is worse than useless here, because a blue background and a
    gold product make the distribution bimodal and the median jumps between the two modes —
    `brass-bowl-hand-02` reported a 93 degree "shift" that way, which is an artefact and not a
    colour change.
    """
    try:
        from enhance import pipeline as _p
        return _p.matte(img, _p.segment(img))
    except Exception:  # noqa: BLE001 — no torch, no weights, no GPU: fall back and say so
        return None


def masked(img: Image.Image, mask):
    """Crop the measurement to the product, by blanking everything else to mid-grey."""
    if mask is None:
        return img
    a = np.asarray(img.convert("RGB")).copy()
    a[np.asarray(mask) <= 0.5] = 128
    return Image.fromarray(a)


def control(folder: Path) -> int:
    """Photographs with **no cast applied**. The right answer is to change nothing."""
    files = sorted(f for f in folder.iterdir()
                   if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"})
    if not files:
        print(f"{folder} is empty")
        return 0

    print(f"control set: {folder}, {len(files)} photographs, no cast applied\n")
    print(f"{'file':40}{'ratio':>7}{'chroma':>16}{'hue move':>10}   verdict")
    damaged = declined = 0
    warned = False
    for f in files:
        try:
            img = Image.open(f).convert("RGB")
        except Exception as e:  # noqa: BLE001 — an unreadable fixture is a finding, not a crash
            print(f"{f.name:40}{'':>7}  UNREADABLE: {type(e).__name__}")
            continue
        img.thumbnail((LONG_EDGE, LONG_EDGE))
        mask = product_mask(img)
        if mask is None and not warned:
            print("  (no segmentation model here — measuring the whole frame, which\n"
                  "   understates the damage. See product_mask().)\n")
            warned = True
        params = pipeline.white_balance(img, None, mask)
        if params is None:
            declined += 1
            print(f"{f.name[:39]:40}{'—':>7}{'':>16}{'':>10}   declined (correct: nothing to read)")
            continue

        out = renderer._apply_white_balance(img, params)
        a, b = masked(img, mask), masked(out, mask)
        c0, c1 = mean_chroma(a), mean_chroma(b)
        dh = abs(hue_of(b) - hue_of(a))
        loss = (c0 - c1) / max(c0, 1e-6)
        bad = dh > HUE_DEGREES_MAX or loss > CHROMA_LOSS_MAX
        damaged += bad
        print(f"{f.name[:39]:40}{params['ratio']:7.2f}{c0:8.1f} ->{c1:6.1f}{dh:9.1f}°   "
              f"{'DAMAGED' if bad else 'ok'}")

    n = len(files) - declined
    print(f"\n{damaged}/{n} corrected photographs damaged, {declined} correctly declined")
    print(f"damage = hue moved over {HUE_DEGREES_MAX}° or chroma fell over {CHROMA_LOSS_MAX:.0%}")
    return 0


def main() -> int:
    for i, a in enumerate(sys.argv):
        if a == "--control":
            return control(Path(sys.argv[i + 1]))

    files = fixtures()
    if not files:
        print("images/raw is empty — the pixels are gitignored, see images/README.md")
        return 0

    caps = [1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2.0] if "--sweep" in sys.argv else \
        [metrics.thresholds()["wb_max_gain_ratio"]]

    print(f"{len(files)} fixtures, cast {tuple(CAST)} (channel ratio {CAST.max()/CAST.min():.2f})\n")
    for cap in caps:
        r = score(cap, files)
        if len(caps) == 1:
            print(f"{'fixture':44}{'true':>7}{'cast':>7}{'after':>7}{'ratio':>7}")
            for name, true_c, cast_c, out_c, ratio in r["rows"]:
                if out_c is None:
                    print(f"{name:44}{true_c:7.1f}{cast_c:7.1f}{'declined':>14}")
                else:
                    print(f"{name:44}{true_c:7.1f}{cast_c:7.1f}{out_c:7.1f}{ratio:7.2f}")
            print()
        print(f"cap {cap:4}  mean |chroma error|: {r['with']:5.2f} with the stage, "
              f"{r['without']:5.2f} without  |  {r['n']} corrected, {r['declined']} declined, "
              f"{r['worse']} made worse")
    return 0


if __name__ == "__main__":
    sys.exit(main())
