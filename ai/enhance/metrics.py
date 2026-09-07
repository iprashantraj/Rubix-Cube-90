"""Pixel measurements for the quality gate, and the one place they are defined.

Both the server gate (`pipeline.gate()`) and the fixture tools in `images/` measure the
same four things, and every threshold in `thresholds.json` was calibrated with the numbers
this module produces. A second implementation would make that calibration evidence for
nothing, so there is one — the same reason there is one thresholds file.

Deliberately numpy + Pillow only. Nothing here needs OpenCV, and the fixture tools must keep
running before anyone has set up an environment.

Memory: a full-resolution pass over a 22MP photograph is the largest thing this service does
per image, and the obvious implementation — decode, build a float64 RGB array, take the luma
— peaks near a gigabyte. Both statistics below are reductions, so they are accumulated over
horizontal bands and peak memory stays flat in the image size. On a worker box sized for
model inference that headroom is not spare.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

THRESHOLDS = Path(__file__).resolve().parent.parent / "thresholds.json"

# Rows per band. Large enough that the per-band overhead is noise, small enough that the
# working set stays in the tens of megabytes on any image a phone can produce.
BAND_ROWS = 256

# The size blur is measured at. Deliberately the same 2000px long edge as
# `segmenter.MASTER_LONG_EDGE`, and not imported from there: this module must stay importable
# without torch, which is what lets `test_gate.py` run the gate's calibration on a bare
# machine. Two copies of one number is a smell; a gate that cannot be checked is worse.
BLUR_LONG_EDGE = 2000


@lru_cache(maxsize=1)
def thresholds() -> dict:
    """The one file, read at runtime. Never bundled, never a second copy.

    Cached for the life of the process: changing a number is a JSON edit and a deploy, not a
    hot reload, so re-reading per image would buy nothing and cost a stat call per photo.
    """
    raw = json.loads(THRESHOLDS.read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def to_gray(img: Image.Image) -> np.ndarray:
    """Rec.601 luma, matching `app/src/camera/gate.js`. Not PIL's 'L', which rounds
    differently — and a gate that disagrees with the one on the phone is worse than no gate.

    For whole images at capture resolution or smaller. Anything full-size goes through
    `full_res()` instead.
    """
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    return (a[..., 0] * 299 + a[..., 1] * 587 + a[..., 2] * 114) / 1000


def blur_score(gray: np.ndarray) -> float:
    """Variance of the Laplacian response. High = sharp.

    Content-dependent, and that is the whole difficulty: a plain white cloth scores blurry
    while being perfectly sharp. See research/RESULTS.md before moving the threshold.
    """
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    c = gray[1:-1, 1:-1]
    lap = gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:] - 4 * c
    return float(lap.var())


def exposure(gray: np.ndarray) -> dict:
    """Mean, and the two clipping fractions.

    Blown and crushed matter more than the mean: a clipped highlight holds no information at
    all and no stage downstream recovers it. The mean only says the photo is dim.
    """
    q = np.clip(gray, 0, 255).astype(np.uint8)
    n = q.size
    return {
        "mean": float(q.mean()),
        "blown": float(np.count_nonzero(q >= 250) / n),
        "crushed": float(np.count_nonzero(q <= 5) / n),
    }


def _band_luma(rgb: np.ndarray) -> np.ndarray:
    """Rec.601 luma for one band of uint8 RGB rows. Same arithmetic as to_gray()."""
    a = rgb.astype(np.float64)
    return (a[..., 0] * 299 + a[..., 1] * 587 + a[..., 2] * 114) / 1000


def full_res(img: Image.Image) -> tuple[float, dict]:
    """Blur score and exposure. Exposure over every pixel; **blur at a fixed size.**

    The two halves are measured differently because they scale differently.

    Exposure is a fraction and a mean, so it is the same number whatever the resolution, and
    it is taken over every pixel in bounded memory — a clipped highlight is a clipped
    highlight and no downscale may average one away.

    **Blur is not scale-invariant, and measuring it at whatever size the phone produced was
    a bug.** Laplacian variance falls as an image is enlarged, because neighbouring pixels in
    an oversampled photograph are nearly identical. Measured on real iPhone 17 uploads from
    Ekamra Haat: a sharp 24MP photograph scored **16.4** against a reject threshold of 20,
    while the same photograph at 2000px scored **436**, and the product region alone scored
    525. Every fixture the threshold was calibrated on is around 2MP, which is why this was
    invisible for the whole life of the gate: it was refusing megapixels, not blur.

    So blur is measured at `BLUR_LONG_EDGE`, the size everything else in the pipeline uses.
    That makes the number mean the same thing for a 2MP feature phone and a 48MP flagship,
    which is the only way one threshold can serve both.
    """
    rgb = np.asarray(img.convert("RGB"))
    h = rgb.shape[0]

    q_n = q_sum = blown = crushed = 0          # exposure, over every pixel
    for top in range(0, h, BAND_ROWS):
        g = _band_luma(rgb[top:min(top + BAND_ROWS, h)])
        q = np.clip(g, 0, 255).astype(np.uint8)
        q_n += q.size
        q_sum += int(q.sum(dtype=np.int64))
        blown += int(np.count_nonzero(q >= 250))
        crushed += int(np.count_nonzero(q <= 5))
        del g, q

    small = img
    if max(img.size) > BLUR_LONG_EDGE:
        small = img.copy()
        small.thumbnail((BLUR_LONG_EDGE, BLUR_LONG_EDGE), Image.LANCZOS)
    blur = blur_score(to_gray(small))

    return max(blur, 0.0), {
        "mean": q_sum / q_n if q_n else 0.0,
        "blown": blown / q_n if q_n else 0.0,
        "crushed": crushed / q_n if q_n else 0.0,
    }
