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
    """Blur score and exposure at full resolution, in bounded memory.

    Returns exactly what `blur_score(to_gray(img))` and `exposure(to_gray(img))` return —
    the band split is an implementation detail, not a different measurement. The Laplacian
    bands carry the previous band's last two rows so the kernel is never split across a
    seam, and the interiors tile rows 1..h-2 once each with no gap and no overlap.
    """
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[0], rgb.shape[1]

    q_n = q_sum = blown = crushed = 0          # exposure, over every pixel
    n = 0                                       # Laplacian, over the interior only
    s_lap = ss_lap = 0.0
    tail: np.ndarray | None = None

    for top in range(0, h, BAND_ROWS):
        g = _band_luma(rgb[top:min(top + BAND_ROWS, h)])

        q = np.clip(g, 0, 255).astype(np.uint8)
        q_n += q.size
        q_sum += int(q.sum(dtype=np.int64))
        blown += int(np.count_nonzero(q >= 250))
        crushed += int(np.count_nonzero(q <= 5))
        del q

        block = g if tail is None else np.vstack((tail, g))
        if block.shape[0] >= 3 and w >= 3:
            c = block[1:-1, 1:-1]
            lap = block[:-2, 1:-1] + block[2:, 1:-1] + block[1:-1, :-2] + block[1:-1, 2:] - 4 * c
            n += lap.size
            s_lap += float(lap.sum(dtype=np.float64))
            ss_lap += float(np.square(lap).sum(dtype=np.float64))
            del c, lap
        tail = g[-2:].copy()
        del g, block

    mean_lap = s_lap / n if n else 0.0
    blur = (ss_lap / n - mean_lap * mean_lap) if n else 0.0
    return max(blur, 0.0), {
        "mean": q_sum / q_n if q_n else 0.0,
        "blown": blown / q_n if q_n else 0.0,
        "crushed": crushed / q_n if q_n else 0.0,
    }
