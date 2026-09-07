"""What was done to a photograph, as parameters rather than as pixels.

`PIPELINE-RECONCILIATION.md` §4 is the argument for this file. Short version: a pipeline
where each stage takes an image and returns a modified image cannot undo, cannot switch
tier without re-running segmentation, cannot re-render with a better mask without throwing
away what the artisan chose, and cannot prove the original was never touched. All four
stop being problems once the stages compute *parameters* and one `render()` at the end is
the only thing that produces pixels.

The recipe is stored on `Product.recipe` — a JSON column, migration `c3a71f0d5e42`. The web
side deliberately left its shape undefined because the shape belongs here.

**Rule 2 ("never destroy the original") holds by construction once this is the only path.**
Not by anyone remembering to keep a copy.

Two fields carry more weight than they look:

`mask_version` is the model and revision that produced the alpha this recipe was built
against. It is what decides who needs re-rendering when a better mask ships, and it is the
key `storage.read_mask()` looks under. A recipe whose mask_version no longer resolves is
still valid — it just costs a segmentation pass to render again.

`tier_source` records whether the tier was chosen by confidence or by the artisan. Once a
person has overruled us, a later re-render must not quietly overrule them back. That is the
whole reason the field exists, and `render()` is the only place it matters.
"""

from __future__ import annotations

VERSION = 2  # bump when a field changes meaning, never when one is added


def mask_version() -> str:
    """Identifies the model that produced an alpha, e.g. `birefnet@e2bf8e44`.

    Model plus revision, because the revision is pinned for a reason — BiRefNet ships
    `trust_remote_code`, so a different revision is a different network, not a patch.
    """
    from . import segmenter

    return f"birefnet@{segmenter.REVISION[:8]}"


def new(*, tier, confidence, crop_box, canvas, fill, mask_signals=None,
        tier_source="auto", mask_ver=None, clahe=None, white_balance=None,
        shadow=None, sharpen=None) -> dict:
    """Build a recipe. Keyword-only — these are all short values of similar type and a
    positional call would be one transposition away from a wrong listing image."""
    return {
        "version": VERSION,
        "mask_version": mask_ver or mask_version(),
        "tier": tier,
        "tier_source": tier_source,
        "confidence": round(float(confidence), 3),
        "mask": mask_signals or {},
        "crop": {"x": crop_box[0], "y": crop_box[1],
                 "w": crop_box[2] - crop_box[0], "h": crop_box[3] - crop_box[1],
                 "canvas": canvas, "fill": fill},
        # Written by stages that do not exist yet. Present and null rather than absent, so
        # a reader never has to distinguish "not applied" from "this recipe predates it".
        "white_balance": white_balance,
        "clahe": clahe,
        "gamma": None,
        "shadow": shadow,
        "sharpen": sharpen,
    }


def with_tier(rec: dict, tier: str, *, by_user: bool) -> dict:
    """Return a copy with the tier changed. **The whole point of the recipe.**

    This is what "the artisan tapped a different tier" costs: a dict copy and a re-render.
    No segmentation, no GPU, no waiting.
    """
    if tier not in ("A", "B", "C"):
        raise ValueError(f"tier must be A, B or C, not {tier!r}")
    out = dict(rec)
    out["tier"] = tier
    out["tier_source"] = "user" if by_user else "auto"
    return out


def validate(rec: dict) -> None:
    """Raise `ValueError` on a recipe `render()` cannot honour.

    Deliberately strict about the crop box. A recipe arrives from a database column that
    anything could have written, and a bad box silently produces a listing image of the
    wrong part of the photograph — which nobody reviews, because the whole point is that it
    renders without a human.
    """
    if not isinstance(rec, dict):
        raise ValueError("recipe must be an object")
    if rec.get("version") != VERSION:
        raise ValueError(f"recipe version {rec.get('version')!r}, this build renders {VERSION}")
    if rec.get("tier") not in ("A", "B", "C"):
        raise ValueError(f"bad tier {rec.get('tier')!r}")
    if rec.get("tier_source") not in ("auto", "user"):
        raise ValueError(f"bad tier_source {rec.get('tier_source')!r}")

    crop = rec.get("crop")
    if not isinstance(crop, dict):
        raise ValueError("recipe has no crop")
    for k in ("x", "y", "w", "h", "canvas"):
        if not isinstance(crop.get(k), int):
            raise ValueError(f"crop.{k} must be an int, got {crop.get(k)!r}")
    if crop["w"] <= 0 or crop["h"] <= 0:
        raise ValueError(f"crop is empty: {crop['w']}x{crop['h']}")
    if crop["canvas"] <= 0:
        raise ValueError(f"crop.canvas must be positive, got {crop['canvas']}")
