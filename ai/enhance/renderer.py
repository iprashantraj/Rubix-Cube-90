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

    tier = rec["tier"]
    if tier == "C":
        # Removes nothing, so it cannot damage the product. See pipeline.apply_tier().
        composited = master
    else:
        alpha = pipeline.feather(mask) if tier == "B" else mask
        composited = pipeline.composite(master, alpha)

    return _crop_to(composited, rec["crop"])


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
