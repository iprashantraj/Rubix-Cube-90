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
    # Sharpening last of the three, because it amplifies whatever contrast it is handed and
    # tone's CLAHE has just changed that contrast. Sharpening first would sharpen a picture
    # the artisan never receives.
    master = _apply_sharpen(master, mask, rec.get("sharpen"))

    tier = rec["tier"]
    if tier == "C":
        # Removes nothing, so it cannot damage the product. See pipeline.apply_tier().
        composited = master
    else:
        alpha = pipeline.feather(mask) if tier == "B" else mask
        composited = pipeline.composite(master, alpha)
        # After compositing, never before: `composite()` asserts that every transparent pixel
        # is exactly 255,255,255, and a shadow's whole job is to darken some of them.
        composited = _apply_shadow(composited, alpha, rec.get("shadow"))

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


def _apply_sharpen(image: Image.Image, mask, params) -> Image.Image:
    """Unsharp mask on lightness, product region only. Spec §5.5, "mild" and no more.

    Null params means the stage declined — no product, or a photograph already sharp enough
    that the honest amount is nothing. Both render unchanged.

    **On the L channel of LAB and nowhere else**, for the same reason `tone()` is: sharpening
    RGB per channel pulls the three apart at every edge and paints coloured fringes along it,
    which is the colour lock's problem arriving through a different door. `a` and `b` come out
    of `to_lab` and go back into `to_rgb_in_gamut` untouched.

    **`max_overshoot` is the ceiling the reconciliation asked for.** An unsharp mask works by
    brightening one side of an edge and darkening the other; past a few L units that stops
    reading as crispness and starts reading as a bright rim — a white halo around a dark pot
    is detail the photograph does not contain, and rule 1 does not care that arithmetic rather
    than a model put it there. The correction is clipped, so no pixel can move further than
    the ceiling however soft the original was.

    Weighted by `_tone_weight()`, the same softened mask the tone stage uses, so the product
    is sharpened and the background is not, with no line between them.
    """
    if not params or params.get("amount", 0) <= 0:
        return image

    import numpy as np
    from PIL import ImageFilter

    from . import colour

    lab = colour.to_lab(np.asarray(image.convert("RGB")))
    L = lab[..., 0]

    blurred = np.asarray(
        Image.fromarray(np.clip(L * 2.55 + 0.5, 0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(int(params["radius_px"]))), np.float32) / 2.55

    ceiling = float(params["max_overshoot"])
    correction = np.clip((L - blurred) * float(params["amount"]), -ceiling, ceiling)

    w = _tone_weight(mask)
    lab[..., 0] = np.clip(L + correction * w, 0.0, 100.0)
    return Image.fromarray(colour.to_rgb_in_gamut(lab), "RGB")


def _apply_shadow(image: Image.Image, mask, params) -> Image.Image:
    """Lay a contact shadow under the product. Spec §6.4.

    Null params means the stage did not run — tier B or C, or a recipe written before this
    existed. Both render unchanged, which is why the field is null rather than absent.

    **The bottom third of the mask, squashed flat, and the squash is not decoration.** The
    spec's recipe — bottom third, blur, offset 18px — draws the shadow *behind* the product,
    where `(1 - mask)` then deletes almost all of it: measured on `brass-rickshaw-inlay-01`,
    the peak darkness is 0.25 and almost none of it survives, leaving a fringe you cannot see
    at listing size. A real shadow lies on the surface the object stands on, so the silhouette
    is flattened toward the contact line first. Then it emerges below the object instead of
    hiding behind it.

    Blurred hard and multiplied, because a shadow subtracts light rather than adding grey.

    **`(1 - mask)` is what keeps this off the product.** The object occludes its own shadow,
    so the darkness is applied to background pixels and fades out under the product's edge
    rather than stopping at a line. No product pixel is darkened by any amount.

    The listing's corners stay exactly white: the shadow is a blurred copy of the mask's
    bottom third nudged 18px down, so it reaches nowhere near the frame's edges, and
    `test_the_shadow_leaves_the_corners_pure_white` holds it there. Marketplaces reject
    near-white, and (252,252,252) is near-white.
    """
    if not params:
        return image

    import numpy as np
    from PIL import ImageFilter

    a = np.clip(np.asarray(mask, dtype=np.float32), 0.0, 1.0)
    rows = np.where(a.max(axis=1) > 0.5)[0]
    if rows.size == 0:
        return image

    # The bottom third of the product's own extent, not of the frame.
    top, bottom = int(rows[0]), int(rows[-1])
    start = top + int(round((bottom - top + 1) * params["from_fraction"]))
    foot = a[start:]
    if foot.shape[0] < 2:
        return image

    # Flatten the foot toward the contact line: the shadow lies on the surface, so it is much
    # wider than it is tall. `squash` is that ratio.
    h = max(2, int(round(foot.shape[0] * float(params["squash"]))))
    flat = np.asarray(
        Image.fromarray((foot * 255).astype(np.uint8)).resize((a.shape[1], h), Image.BILINEAR),
        np.float32) / 255.0

    layer = np.zeros_like(a)
    off = int(params["offset_px"])
    y0 = min(bottom - h + off, a.shape[0] - h)
    y0 = max(y0, 0)
    layer[y0:y0 + h] = flat[:a.shape[0] - y0]

    soft = np.asarray(
        Image.fromarray((layer * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(int(params["blur_px"]))), np.float32) / 255.0

    darkness = soft * float(params["opacity"]) * (1.0 - a)
    out = np.asarray(image.convert("RGB"), np.float32) * (1.0 - darkness)[..., None]
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGB")


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
