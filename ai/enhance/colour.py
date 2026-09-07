"""sRGB <-> CIELAB, and CLAHE on lightness. numpy and Pillow only.

Why not OpenCV, when `requirements.txt` already has it: `test_gate.py`, `test_segment.py`
and `test_recipe.py` all run on a bare machine with `python3` and nothing installed, and
that property is what keeps the pipeline's numbers checkable by anyone who clones the repo.
`metrics.py` makes the same choice for the same reason.

**Everything here works on lightness only and never touches a or b.** Spec §5.3 is explicit:
CLAHE on RGB shifts hue, and a saree that changes shade between the photograph and the
parcel is the misrepresentation `CLAUDE.md` rule 1 forbids and rule 4's colour lock exists to
catch. Operating on L means the contrast changes and the colour provably does not — a and b
come out of `to_lab` and go back into `to_rgb` bit-for-bit unmodified.
"""

from __future__ import annotations

import numpy as np

# D65, the white point sRGB is defined against.
_WHITE = np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
_M_RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
_M_XYZ2RGB = np.linalg.inv(_M_RGB2XYZ).astype(np.float32)


def _srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.maximum(c, 0.0) ** (1 / 2.4) - 0.055)


def to_lab(rgb_u8: np.ndarray) -> np.ndarray:
    """uint8 HxWx3 sRGB -> float32 HxWx3 Lab, L in 0..100."""
    lin = _srgb_to_linear(rgb_u8.astype(np.float32) / 255.0)
    xyz = lin @ _M_RGB2XYZ.T / _WHITE
    d = 6.0 / 29.0
    f = np.where(xyz > d ** 3, np.cbrt(xyz), xyz / (3 * d * d) + 4.0 / 29.0)
    return np.stack([116 * f[..., 1] - 16,
                     500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])], axis=-1).astype(np.float32)


def to_rgb(lab: np.ndarray) -> np.ndarray:
    """float32 Lab -> uint8 sRGB. Inverse of `to_lab` to within one 8-bit step."""
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    d = 6.0 / 29.0
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f > d, f ** 3, 3 * d * d * (f - 4.0 / 29.0)) * _WHITE
    lin = xyz @ _M_XYZ2RGB.T
    return np.clip(_linear_to_srgb(lin) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def to_rgb_in_gamut(lab: np.ndarray) -> np.ndarray:
    """Lab -> uint8 sRGB, **preserving hue exactly** and only ever reducing chroma.

    `to_rgb` clips out-of-gamut colours per channel, and that clip moves hue. It is invisible
    on ordinary photographs and very visible on a saturated one: raising L on a deep maroon
    pushes red past 1.0, the clip flattens red alone, and the maroon walks toward orange —
    which is precisely the failure the colour lock exists to catch, arrived at by arithmetic
    instead of by a bad white balance.

    Measured on three fixtures before this existed: up to **16.5** of a/b shift inside the
    product after a lightness-only correction. Hue was not preserved at all.

    So out-of-gamut pixels have their chroma scaled down — hue angle `atan2(b, a)` is
    untouched, and chroma only ever decreases, never increases. A colour that will not fit in
    sRGB becomes a less saturated version of *the same colour*, which is a representable
    answer rather than a different one. Bisection, ten steps, which lands within 0.1% of the
    largest chroma that fits.
    """
    def linear_of(scale):
        scaled = lab.copy()
        scaled[..., 1] *= scale
        scaled[..., 2] *= scale
        fy = (scaled[..., 0] + 16) / 116
        fx = fy + scaled[..., 1] / 500
        fz = fy - scaled[..., 2] / 200
        d = 6.0 / 29.0
        f = np.stack([fx, fy, fz], axis=-1)
        xyz = np.where(f > d, f ** 3, 3 * d * d * (f - 4.0 / 29.0)) * _WHITE
        return xyz @ _M_XYZ2RGB.T

    ones = np.ones(lab.shape[:2], dtype=np.float32)
    lin = linear_of(ones)
    # A hair of tolerance: rounding to 8 bits absorbs less than half a step anyway, and
    # without it almost every pure white pixel counts as out of gamut.
    bad = (lin < -1e-4) | (lin > 1 + 1e-4)
    out_of_gamut = bad.any(axis=-1)
    if not out_of_gamut.any():
        return np.clip(_linear_to_srgb(lin) * 255.0 + 0.5, 0, 255).astype(np.uint8)

    lo = np.zeros_like(ones)
    hi = ones.copy()
    for _ in range(10):
        mid = (lo + hi) / 2.0
        lin_mid = linear_of(mid)
        fits = ~((lin_mid < -1e-4) | (lin_mid > 1 + 1e-4)).any(axis=-1)
        lo = np.where(fits, mid, lo)
        hi = np.where(fits, hi, mid)

    scale = np.where(out_of_gamut, lo, ones)
    lin = linear_of(scale)
    return np.clip(_linear_to_srgb(lin) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def clahe_l(lightness: np.ndarray, clip_limit: float, tiles: int) -> np.ndarray:
    """Contrast-limited adaptive histogram equalisation on an L plane (0..100).

    Tiles the image, equalises each tile's histogram with the excess above `clip_limit`
    redistributed rather than discarded, then bilinearly interpolates between neighbouring
    tile mappings so no tile edge is visible in the result.

    The clip is the whole point: plain adaptive equalisation amplifies whatever is in a flat
    tile, which on a photograph of plain cloth means amplifying sensor noise into visible
    grain. `clip_limit` is what stops a smooth background becoming mud.
    """
    h, w = lightness.shape
    ty, tx = max(1, tiles), max(1, tiles)
    bins = 256

    q = np.clip(lightness / 100.0 * (bins - 1) + 0.5, 0, bins - 1).astype(np.int32)
    ys = np.linspace(0, h, ty + 1).astype(int)
    xs = np.linspace(0, w, tx + 1).astype(int)

    maps = np.empty((ty, tx, bins), dtype=np.float32)
    for i in range(ty):
        for j in range(tx):
            tile = q[ys[i]:ys[i + 1], xs[j]:xs[j + 1]]
            hist = np.bincount(tile.ravel(), minlength=bins).astype(np.float32)
            if tile.size:
                limit = max(1.0, clip_limit * tile.size / bins)
                excess = np.maximum(hist - limit, 0).sum()
                hist = np.minimum(hist, limit) + excess / bins
                cdf = np.cumsum(hist)
                cdf /= max(cdf[-1], 1e-6)
            else:
                cdf = np.linspace(0, 1, bins, dtype=np.float32)
            maps[i, j] = cdf * 100.0

    # Tile centres, then bilinear weights for every pixel between them.
    cy = (ys[:-1] + ys[1:] - 1) / 2.0
    cx = (xs[:-1] + xs[1:] - 1) / 2.0
    yy = np.arange(h, dtype=np.float32)
    xx = np.arange(w, dtype=np.float32)

    iy = np.clip(np.searchsorted(cy, yy) - 1, 0, ty - 2) if ty > 1 else np.zeros(h, int)
    ix = np.clip(np.searchsorted(cx, xx) - 1, 0, tx - 2) if tx > 1 else np.zeros(w, int)
    fy = ((yy - cy[iy]) / np.maximum(cy[iy + 1] - cy[iy], 1e-6)).clip(0, 1) if ty > 1 else np.zeros(h, np.float32)
    fx = ((xx - cx[ix]) / np.maximum(cx[ix + 1] - cx[ix], 1e-6)).clip(0, 1) if tx > 1 else np.zeros(w, np.float32)

    iy2 = np.minimum(iy + 1, ty - 1)
    ix2 = np.minimum(ix + 1, tx - 1)
    FY = fy[:, None]
    FX = fx[None, :]

    def lookup(ti, tj):
        return maps[ti[:, None], tj[None, :], q]

    out = ((1 - FY) * (1 - FX) * lookup(iy, ix)
           + (1 - FY) * FX * lookup(iy, ix2)
           + FY * (1 - FX) * lookup(iy2, ix)
           + FY * FX * lookup(iy2, ix2))
    return out.astype(np.float32)
