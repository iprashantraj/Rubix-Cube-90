"""`render(original, mask, recipe)` — the only thing in the pipeline that produces pixels.

Everything else computes parameters. That single rule is what makes `CLAUDE.md` rule 2
("never destroy the original") true by construction: no stage writes an image, so no stage
can write over the one the artisan gave us.

It is also what makes the three things the reconciliation asked for cheap:

  undo               change a field, render again
  switch tier        change a field, render again — no segmentation, no GPU
  better mask ships  render again with a new alpha, keeping every choice already made

Deliberately dumb. It reads a recipe and applies it; it makes no decisions. Anything that
needs to *decide* something belongs in `pipeline.py`, because a decision made here would be
invisible to the recipe and therefore unreproducible — which defeats the point of having
one.

Stages not written yet — `white_balance`, `clahe`, `gamma`, `shadow` — are null in the
recipe and skipped here. When they land, each is a branch in this function and a field in
`recipe.new()`, and old recipes keep rendering because null means "not applied".
"""

from __future__ import annotations

from PIL import Image

from . import pipeline, recipe as recipe_mod


def render(original: Image.Image, mask, rec: dict) -> Image.Image:
    """Rebuild the listing image. Returns a square RGB image at `recipe.crop.canvas`.

    `original` is the 2000px master, not the raw upload — the mask was measured against the
    master and a recipe's crop box is in master coordinates. `pipeline.master_for()` is what
    produces it, from either side of a re-render.

    `mask` is a float [0,1] alpha at the master's size, from `segment()` on a first run or
    `storage.read_mask()` on a re-render.
    """
    recipe_mod.validate(rec)

    master = original.convert("RGB")
    if mask.shape[:2] != (master.height, master.width):
        # A recipe rendered against a differently-sized master would crop the wrong region
        # and look almost right, which is the worst way for this to fail.
        raise ValueError(
            f"mask {mask.shape[:2]} does not match master "
            f"{(master.height, master.width)} — re-segment rather than rescale"
        )

    # White balance first: it changes the ratios between channels, and tone measures the
    # lightness those ratios produce. Measuring tone against uncorrected pixels and applying
    # it to corrected ones would be a small, permanent mismatch. `pipeline.run()` measures in
    # the same order for the same reason.
    master = _apply_white_balance(master, rec.get("white_balance"))
    master = _apply_tone(master, mask, rec.get("clahe"))

    tier = rec["tier"]
    if tier == "C":
        # Removes nothing, so it cannot damage the product. See pipeline.apply_tier().
        composited = master
    else:
        alpha = pipeline.feather(mask) if tier == "B" else mask
        composited = pipeline.composite(master, alpha)

    return _crop_to(composited, rec["crop"])


def _apply_white_balance(image: Image.Image, params) -> Image.Image:
    """Scale the three channels by the recipe's gains. **The whole colour correction is
    these three numbers**, which is what makes it replayable, inspectable and undoable.

    Null params means `white_balance()` declined — no reference patch it could trust, or
    nothing in the frame plausibly neutral. The image is returned exactly as photographed,
    which is why the field is null rather than absent.

    `pipeline.white_balance()` normalises the gains so none exceeds 1, so this can only
    darken a channel. Nothing here can push a channel past 255 and invent a colour at the
    top end that the photograph never held.
    """
    if not params:
        return image

    import numpy as np

    gains = np.asarray(params["gains"], dtype=np.float32)
    if gains.shape != (3,):
        raise ValueError(f"white_balance gains must be three numbers, got {params['gains']}")

    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) * gains
    return Image.fromarray(np.clip(rgb + 0.5, 0, 255).astype(np.uint8), "RGB")


def _apply_tone(image: Image.Image, mask, params) -> Image.Image:
    """Levels + CLAHE on lightness, weighted by the mask so only the product is corrected.

    Null params means the stage did not run — a recipe written before `tone()` existed, or a
    product flat enough that `tone()` declined. Both render unchanged, which is why the field
    is null rather than absent.

    **The mask weights the correction rather than gating it**, and the weight is softened
    first — `_tone_weight()`, which is where the measurement and the trade-off live. A hard
    `where(mask)` would leave a visible seam exactly on the product's edge, and on tier C —
    where the background stays — that seam would be the most obvious thing in the picture.

    a and b are carried through untouched and the conversion back to sRGB preserves hue
    exactly — see `colour.to_rgb_in_gamut()`, which exists because a plain per-channel clip
    walked a deep maroon toward orange by up to 16.5 of a/b. Chroma can only *decrease*, and
    only for a colour that does not fit in sRGB at its new lightness. Nothing here can invent
    a colour the object does not have.
    """
    if not params:
        return image

    import numpy as np

    from . import colour

    w = _tone_weight(mask)
    lab = colour.to_lab(np.asarray(image.convert("RGB")))
    L = lab[..., 0]

    black, white = float(params["black"]), float(params["white"])
    span = max(white - black, 1e-3)
    stretched = np.clip((L - black) / span, 0.0, 1.0) * 100.0
    equalised = colour.clahe_l(stretched, float(params["clip_limit"]), int(params["tiles"]))

    lab[..., 0] = L * (1.0 - w) + equalised * w
    return Image.fromarray(colour.to_rgb_in_gamut(lab), "RGB")


def _tone_weight(mask):
    """How much of the correction each pixel gets: the mask, softened.

    **The mask alone is too sharp for this, and it is not a mask problem.** BiRefNet's alpha
    ramps over 3-4px at the 2000px master, which is right for cutting a fringe out and wrong
    for delivering a brightness change: measured on `pottery-potter-indoor-04`, an 11.1 L
    correction across that ramp is 3.3 L per pixel, and a step that size traces the product
    with a visible line on tier C, where the background is not replaced. Widening the ramp to
    ~11px puts the same correction at about 1 L per pixel, which reads as shading.

    The cost is honest and is the reason this is a separate, named step: the correction now
    reaches roughly `tone_edge_blur_px` into the background. A few pixels of very slightly
    corrected background is a much smaller lie than a bright outline around the product, and
    it is invisible on tiers A and B where that background is replaced by white anyway.

    **Softens the weight, never the mask.** Compositing still cuts at the alpha's own
    sharpness, so nothing here costs a fringe or a stray thread.
    """
    import numpy as np
    from PIL import ImageFilter

    from . import metrics, pipeline

    radius = int(metrics.thresholds()["tone_edge_blur_px"])
    w = np.clip(np.asarray(mask, dtype=np.float32), 0.0, 1.0)
    if radius <= 0:
        return w
    # Same BoxBlur as pipeline.feather(), deliberately not the same radius: that number is
    # tier B's edge treatment and answers a different question. One knob, one meaning.
    soft = Image.fromarray((w * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(radius))
    return np.asarray(soft, np.float32) / 255.0


def _crop_to(image: Image.Image, crop: dict) -> Image.Image:
    """Apply a stored crop box. White outside the photograph, as `pipeline.crop()` does.

    The box is replayed exactly rather than recomputed. Recomputing would let the framing
    drift between renders of the same recipe — and after an artisan has approved a listing
    image, a later re-render moving the product is a change they never asked for.
    """
    canvas = crop["canvas"]
    x0, y0 = crop["x"], crop["y"]
    x1, y1 = x0 + crop["w"], y0 + crop["h"]

    square = Image.new("RGB", (crop["w"], crop["h"]), (255, 255, 255))
    ix0, iy0 = max(x0, 0), max(y0, 0)
    ix1, iy1 = min(x1, image.width), min(y1, image.height)
    if ix1 > ix0 and iy1 > iy0:
        square.paste(image.crop((ix0, iy0, ix1, iy1)), (ix0 - x0, iy0 - y0))

    if square.size == (canvas, canvas):
        return square
    return square.resize((canvas, canvas), Image.LANCZOS)
