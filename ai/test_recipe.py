"""The recipe and the renderer — step 5.

    cd ai && python3 test_recipe.py      # recipe half; renderer half needs Pillow+numpy only
    cd ai && .venv/bin/pytest test_recipe.py

Most of this runs without a venv, because most of step 5 is bookkeeping rather than model
work. Only the tests that need a real mask reach for torch.

What is worth guarding here is not that a picture appears. It is the three properties the
recipe exists to provide: the original is never written, a re-render reproduces the same
pixels, and a tier the artisan chose is not quietly overruled later.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

# These exercise the pipeline; none of them may append to a real observation log.
import os as _os  # noqa: E402
_os.environ.setdefault("AI_OBSERVE", "0")

from enhance import colour, metrics, pipeline, recipe, renderer, storage  # noqa: E402

T = metrics.thresholds()


class Skip(Exception):
    pass


def _rec(tier="A", box=(100, 100, 900, 900)):
    return recipe.new(tier=tier, confidence=1.0, crop_box=box,
                      canvas=T["listing_canvas_px"], fill=T["crop_fill_target"],
                      mask_ver="test@0000")


def _master(w=1000, h=1000):
    a = np.zeros((h, w, 3), np.uint8)
    a[:, :] = (30, 90, 160)
    return Image.fromarray(a, "RGB")


def _alpha(w=1000, h=1000, box=(200, 200, 800, 800)):
    m = np.zeros((h, w), np.float32)
    l, t, r, b = box
    m[t:b, l:r] = 1.0
    return m


# ------------------------------------------------------------------- the shape


def test_recipe_carries_the_model_that_made_the_mask():
    r = recipe.new(tier="A", confidence=1.0, crop_box=(0, 0, 10, 10), canvas=2000, fill=0.85)
    assert r["mask_version"].startswith("birefnet@"), r["mask_version"]


def test_unwritten_stages_are_null_not_absent():
    """Null means 'not applied'. Absent would be indistinguishable from 'this recipe
    predates the stage', and then a reader cannot tell which."""
    r = _rec()
    for k in ("white_balance", "clahe", "gamma", "shadow"):
        assert k in r and r[k] is None, k


def test_validate_rejects_an_empty_crop():
    r = _rec(box=(100, 100, 100, 100))
    try:
        recipe.validate(r)
    except ValueError:
        return
    raise AssertionError("empty crop accepted")


def test_validate_rejects_a_future_version():
    r = _rec(); r["version"] = 999
    try:
        recipe.validate(r)
    except ValueError:
        return
    raise AssertionError("unknown version accepted")


def test_validate_rejects_a_bad_tier():
    r = _rec(); r["tier"] = "D"
    try:
        recipe.validate(r)
    except ValueError:
        return
    raise AssertionError("tier D accepted")


# --------------------------------------------------------------- the tier swap


def test_with_tier_marks_a_user_choice():
    """Once a person overrules the confidence score, a later automatic pass must not
    quietly overrule them back."""
    r = _rec()
    assert r["tier_source"] == "auto"
    out = recipe.with_tier(r, "C", by_user=True)
    assert out["tier"] == "C" and out["tier_source"] == "user"


def test_with_tier_does_not_mutate_the_original():
    r = _rec()
    recipe.with_tier(r, "C", by_user=True)
    assert r["tier"] == "A", "with_tier mutated its input"


def test_with_tier_refuses_a_tier_that_does_not_exist():
    try:
        recipe.with_tier(_rec(), "Z", by_user=True)
    except ValueError:
        return
    raise AssertionError("tier Z accepted")


# ------------------------------------------------------------------- rendering


def test_render_never_touches_the_original():
    """Rule 2, and the whole reason this file exists."""
    src = _master()
    before = np.asarray(src).copy()
    renderer.render(src, _alpha(), _rec())
    assert np.array_equal(np.asarray(src), before), "render modified its input image"


def test_render_is_deterministic():
    """A second render of the same recipe must be the same pixels. Without this, 'undo'
    and 'switch back' silently produce a slightly different listing image."""
    src, a, r = _master(), _alpha(), _rec()
    one = np.asarray(renderer.render(src, a, r))
    two = np.asarray(renderer.render(src, a, r))
    assert np.array_equal(one, two)


def test_render_output_is_the_listing_canvas():
    out = renderer.render(_master(), _alpha(), _rec())
    assert out.size == (T["listing_canvas_px"], T["listing_canvas_px"])


def test_tier_c_leaves_the_background_alone():
    """C removes nothing, so the background keeps the photograph's colour, not white."""
    out = renderer.render(_master(), _alpha(), _rec(tier="C"))
    assert np.asarray(out)[5, 5].tolist() == [30, 90, 160]


def test_tier_a_puts_the_background_on_white():
    out = renderer.render(_master(), _alpha(), _rec(tier="A"))
    assert out.load()[5, 5] == (255, 255, 255)


def test_switching_tier_changes_the_pixels_without_a_new_mask():
    """The payoff: same original, same mask, different result."""
    src, a = _master(), _alpha()
    r = _rec(tier="A")
    hard = np.asarray(renderer.render(src, a, r))
    soft = np.asarray(renderer.render(src, a, recipe.with_tier(r, "C", by_user=True)))
    assert not np.array_equal(hard, soft)


def test_render_refuses_a_mask_of_the_wrong_size():
    """A recipe rendered against a different master crops the wrong region and looks
    almost right — the worst way for this to fail."""
    try:
        renderer.render(_master(1000, 1000), _alpha(800, 800), _rec())
    except ValueError:
        return
    raise AssertionError("mismatched mask accepted")


def test_crop_box_is_replayed_not_recomputed():
    """After an artisan approves a listing image, a later re-render moving the product is
    a change they never asked for."""
    src, a = _master(), _alpha()          # product occupies 200..800
    # A box entirely outside the product. If the box were recomputed from the mask this
    # would frame the product instead, and the result would not be blank.
    out = np.asarray(renderer.render(src, a, _rec(box=(0, 0, 150, 150))))
    assert (out == 255).all(), "crop box was not the region rendered"
    # And a different box must give a different picture from the same recipe otherwise.
    other = np.asarray(renderer.render(src, a, _rec(box=(200, 200, 800, 800))))
    assert not np.array_equal(out, other)


# --------------------------------------------------------------- mask storage


def test_mask_survives_a_round_trip():
    a = _alpha(64, 64, (10, 10, 50, 50))
    storage.write_mask(a, "p_unit", "test@0000")
    back = storage.read_mask("p_unit", "test@0000")
    assert back.shape == a.shape
    assert np.abs(back - a).max() < 0.01, "mask changed on the way through storage"


def test_missing_mask_is_a_source_error_not_a_crash():
    """Masks are derived data and can be evicted. The answer is to re-segment, and the
    caller can only decide that if this is distinguishable from a real failure."""
    try:
        storage.read_mask("p_does_not_exist", "test@0000")
    except storage.SourceError:
        return
    raise AssertionError("missing mask did not raise SourceError")


# ------------------------------------------------------------------ tone/colour


def _photo(w=200, h=200, seed=3):
    rng = np.random.default_rng(seed)
    base = rng.integers(40, 210, (h, w, 3)).astype(np.uint8)
    return Image.fromarray(base, "RGB")


def test_lab_round_trip_is_exact():
    """Every tone correction goes through this. A lossy round trip would shift colour on
    photographs the stage decided not to change at all."""
    rng = np.random.default_rng(0)
    a = rng.integers(0, 256, (64, 64, 3), dtype=np.uint8)
    assert np.array_equal(colour.to_rgb(colour.to_lab(a)), a)


def test_gamut_mapping_is_a_passthrough_when_nothing_is_out_of_gamut():
    rng = np.random.default_rng(2)
    a = rng.integers(60, 200, (32, 32, 3), dtype=np.uint8)
    lab = colour.to_lab(a)
    assert np.array_equal(colour.to_rgb_in_gamut(lab), colour.to_rgb(lab))


def test_tone_never_raises_chroma():
    """Rule 1. The stage may make a colour less saturated to fit sRGB; it may never make a
    product more colourful than it was."""
    src = _photo()
    a = np.ones((src.height, src.width), np.float32)
    params = pipeline.tone(src, a)
    out = renderer._apply_tone(src, a, params)
    c0 = np.hypot(*[colour.to_lab(np.asarray(src))[..., i] for i in (1, 2)])
    c1 = np.hypot(*[colour.to_lab(np.asarray(out))[..., i] for i in (1, 2)])
    assert (c1 <= c0 + 1.0).all(), f"chroma rose by {float((c1 - c0).max()):.2f}"


def test_tone_preserves_hue():
    """Measured on real fixtures at mean 0.4-0.8 degrees. A per-channel clip instead of
    gamut mapping moved a/b by up to 16.5, which walks a deep maroon toward orange."""
    src = _photo(seed=5)
    a = np.ones((src.height, src.width), np.float32)
    out = renderer._apply_tone(src, a, pipeline.tone(src, a))
    l0, l1 = colour.to_lab(np.asarray(src)), colour.to_lab(np.asarray(out))
    c = np.hypot(l0[..., 1], l0[..., 2])
    keep = (c > 10) & (np.hypot(l1[..., 1], l1[..., 2]) > 10)
    h0 = np.arctan2(l0[..., 2], l0[..., 1])[keep]
    h1 = np.arctan2(l1[..., 2], l1[..., 1])[keep]
    d = np.abs(np.degrees(np.arctan2(np.sin(h1 - h0), np.cos(h1 - h0))))
    assert d.mean() < 3.0, f"mean hue shift {d.mean():.2f} deg"


def test_tone_declines_on_a_flat_product():
    """A swatch filling the frame has nothing to stretch, and stretching it amplifies
    sensor noise into visible grain."""
    flat = Image.new("RGB", (80, 80), (128, 128, 128))
    assert pipeline.tone(flat, np.ones((80, 80), np.float32)) is None


def test_tone_declines_when_there_is_no_product():
    assert pipeline.tone(_photo(), np.zeros((200, 200), np.float32)) is None


def test_tone_caps_the_stretch():
    """A dark product photographed in a dim room is a dark product. Pulling it wide until
    it looks studio-lit invents an appearance the object does not have."""
    dark = Image.fromarray(
        (np.random.default_rng(7).integers(10, 45, (120, 120, 3))).astype(np.uint8), "RGB")
    p = pipeline.tone(dark, np.ones((120, 120), np.float32))
    span = p["white"] - p["black"]
    assert 100.0 / span <= metrics.thresholds()["tone_max_stretch"] + 1e-6, span


def test_null_tone_renders_unchanged():
    """Recipes written before this stage existed must keep rendering."""
    src = _photo()
    a = np.ones((src.height, src.width), np.float32)
    assert renderer._apply_tone(src, a, None) is src


def test_tone_only_touches_the_product():
    """Background stays as photographed — visible on tier C, where it is not replaced."""
    src = _photo(seed=9)
    a = np.zeros((src.height, src.width), np.float32)
    a[50:150, 50:150] = 1.0
    out = np.asarray(renderer._apply_tone(src, a, pipeline.tone(src, a)))
    before = np.asarray(src)
    assert np.array_equal(out[0:40, 0:40], before[0:40, 0:40]), "background was modified"


# The seam threshold. A brightness change spread over several pixels reads as shading; the
# same change delivered in one pixel reads as a line. Somewhere around 1-2 L units per pixel
# is where one becomes the other on photographic content, so this is a smoke alarm, not a
# measurement of perception — if it trips, look at the picture before touching the number.
SEAM_L_PER_PX = 2.0


def _model_available():
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def test_the_tone_edge_is_not_a_visible_seam():
    """Tone corrects inside the mask and not outside. **On tier C the background survives**,
    so that boundary is in the delivered image, and a correction that arrives too abruptly
    reads as a halo tracing the product.

    This needs a real BiRefNet mask, because the softness under test is the model's. A
    synthetic mask would measure the fixture. `matte()` is a no-op on the strength of that
    softness (3-4px band, RESULTS.md), and this is the half of that argument RESULTS.md did
    not make: soft enough for fringes was established, soft enough to hide a tone step
    was not.

    Measures the full correction strength, the width of the alpha ramp that has to deliver
    it, and the ratio.
    """
    if not _model_available():
        raise Skip("no torch/transformers")
    from enhance import segmenter

    fixture = Path(__file__).resolve().parent.parent / "images" / "raw" / "pottery-potter-indoor-04.jpg"
    if not fixture.exists():
        raise Skip("fixture pixels are gitignored")

    master = segmenter.to_master(Image.open(fixture).convert("RGB"))
    alpha = pipeline.matte(master, pipeline.segment(master))
    params = pipeline.tone(master, alpha)
    if params is None:
        raise Skip("tone declined on this fixture")

    before = colour.to_lab(np.asarray(master))[..., 0]
    after = colour.to_lab(np.asarray(renderer._apply_tone(master, alpha, params)))[..., 0]
    delta = after - before

    solid = alpha > 0.95
    assert solid.any(), "no solid product region"
    # Outside is weighted to zero, so the ramp carries the whole correction.
    strength = float(np.abs(delta[solid]).mean())

    # Measured on the weight the renderer actually uses, not on the raw alpha: softening
    # that weight is exactly the fix this test exists to demand, and a test that could not
    # see the fix would fail forever.
    weight = renderer._tone_weight(alpha)

    # Ramp width as area over perimeter: the soft band is a ribbon one perimeter long, so
    # its area divided by its length is its thickness.
    soft = (weight > 0.05) & (weight < 0.95)
    inside = weight > 0.5
    perimeter = int((inside[:, :-1] != inside[:, 1:]).sum() + (inside[:-1] != inside[1:]).sum())
    assert perimeter > 0, "mask has no boundary"
    width = soft.sum() / perimeter

    per_px = strength / max(width, 1e-6)
    print(f"        strength {strength:.1f} L over {width:.1f}px = {per_px:.2f} L/px", end="")
    assert per_px < SEAM_L_PER_PX, (
        f"tone edge is {per_px:.2f} L/px ({strength:.1f} L across {width:.1f}px) — "
        f"blur the weight in renderer._apply_tone()")


# ------------------------------------------------------------------ white balance
#
# The one stage that moves colour on purpose, so it is the one rule 4 exists to police.


# Deliberately inside `wb_max_gain_ratio` (1.25 against a cap of 1.3), so a test of whether
# the method reads the light measures that and not the cap. The cap has its own test, with a
# cast violent enough to trip it.
WARM = np.array([1.15, 1.0, 0.92], np.float32)
IDEAL = (1 / WARM) / (1 / WARM).max()                # the gains that would undo it exactly


def _cast(img, gains=WARM):
    return Image.fromarray(
        np.clip(np.asarray(img, np.float32) * np.asarray(gains, np.float32), 0, 255).astype(np.uint8))


def _mean_chroma(img):
    lab = colour.to_lab(np.asarray(img))
    return float(np.hypot(lab[..., 1], lab[..., 2]).mean())


def _scene(seed=11):
    """A photograph with something plausibly neutral in it, which is the case both methods
    are for. Pure noise has no grey and neither method should pretend otherwise."""
    rng = np.random.default_rng(seed)
    a = np.full((300, 300, 3), 150, np.uint8)
    a[:120] = rng.integers(30, 90, (120, 300, 3))            # a dark object
    a[120:] = 140 + rng.integers(-10, 10, (180, 300, 3))     # a plain wall
    return Image.fromarray(a)


def test_the_tapped_patch_recovers_the_illuminant():
    """The accurate path, and the reason the `white_ref` rect is worth one tap on the review
    screen: the patch is a direct reading of the light rather than an assumption about it."""
    a = np.asarray(_scene(), np.float32).copy()
    a[10:60, 10:60] = 175                                    # the paper. Not blown.
    img = _cast(Image.fromarray(a.astype(np.uint8)))
    p = pipeline.white_balance(img, {"x": 0.03, "y": 0.03, "w": 0.16, "h": 0.16})
    assert p["method"] == "patch", p
    assert np.abs(np.asarray(p["gains"]) - IDEAL).max() < 0.15, (p["gains"], IDEAL)


def test_a_blown_reference_patch_is_refused():
    """Every channel reads 255 whatever the light was. Calibrating off that would invent a
    colour, and rule 1 does not care that arithmetic rather than a model did it."""
    flat = Image.fromarray(np.full((200, 200, 3), 254, np.uint8))
    assert pipeline.white_balance(flat, {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3}) is None


def _paper(img, box=(10, 10, 60, 60), value=175):
    """A white reference in frame. Not blown — a patch at 255 holds no colour."""
    a = np.asarray(img, np.float32).copy()
    a[box[1]:box[3], box[0]:box[2]] = value
    return Image.fromarray(a.astype(np.uint8))


REF = {"x": 0.03, "y": 0.03, "w": 0.16, "h": 0.16}


def test_no_white_reference_means_no_correction():
    """**The default, and it is measured rather than cautious.** On 33 real photographs from
    Ekamra Haat with nothing wrong with them, the neutral path damaged 20 — every dhokra
    piece lost 43-62% of its chroma and a cream cloth moved 29.6 degrees of hue. No
    reference-free method separates warm light from a warm object, and the crafts are warm.
    `images/wb_check.py --control images/haat`."""
    assert pipeline.white_balance(_cast(_scene())) is None
    assert T["wb_neutral_enabled"] is False


def test_a_product_filling_the_frame_is_refused_not_guessed():
    """**The failure gray-world is named for**, and the neutral path's own guard against it:
    a maroon Sambalpuri filling the frame makes "the average of this scene is grey" false in
    exactly the direction that pulls a natural dye toward orange. Tested at the level of the
    estimator, since the path above it is off by default."""
    rng = np.random.default_rng(3)
    maroon = np.array([120, 25, 45]) + rng.integers(-12, 12, (300, 300, 3))
    rgb = maroon.clip(0, 255).astype(np.float32)
    assert pipeline._neutral_means(rgb, T) is None


def test_the_neutral_estimator_still_reads_a_cast_it_can_see():
    """Kept because the method is sound where a cast is *known* to exist, and because it is
    what the white-reference path will be measured against."""
    means = pipeline._neutral_means(np.asarray(_cast(_scene()), np.float32), T)
    assert means is not None
    # Warm cast: the red channel reads high and the blue low, which is what gets equalised.
    assert means[0] > means[2], means


def test_gains_never_exceed_one():
    """The correction may only darken a channel. A gain above 1 could push a channel past
    255 and clip it into a colour the photograph never held."""
    p = pipeline.white_balance(_cast(_paper(_scene())), REF)
    assert max(p["gains"]) <= 1.0, p["gains"]


def test_the_correction_is_capped():
    """An extreme reading is far more often a bad measurement than a genuinely extreme
    illuminant, and being wrong costs the artisan the return."""
    # The paper is dim on purpose: at 175 a 1.9x red gain clips the patch, and a blown
    # reference is refused before the cap is ever reached.
    violent = _cast(_paper(_scene(), value=120), [1.9, 1.0, 0.45])
    p = pipeline.white_balance(violent, REF)
    assert p["ratio"] <= T["wb_max_gain_ratio"] + 1e-6, p


def test_null_white_balance_renders_unchanged():
    """Declined, or a recipe written before the stage existed. Both must still render."""
    src = _photo()
    assert renderer._apply_white_balance(src, None) is src


def test_a_colour_shift_warns_and_the_warning_survives_a_rerender():
    """Rule 4. Nothing publishes without `colour_confirmed`, and the artisan does not stop
    needing to confirm the colour because they changed the background."""
    wb = {"method": "patch", "gains": [0.6, 0.8, 1.0], "ratio": 1.67}
    assert any("colour shifted" in w for w in pipeline._warnings_for("A", None, wb))
    assert pipeline._warnings_for("A", None, None) == []
    assert pipeline._warnings_for("A", None, {"ratio": 1.0}) == []


def test_white_balance_is_applied_before_tone():
    """Tone measures the lightness the corrected channels produce, so the render has to
    correct colour first. Applied in the other order the recipe's numbers would describe a
    picture the renderer never makes."""
    src = _photo()
    a = np.ones((src.height, src.width), np.float32)
    wb = {"method": "patch", "gains": [0.7, 0.85, 1.0], "ratio": 1.43}
    rec = _rec(tier="C", box=(0, 0, src.width, src.height))
    rec["white_balance"] = wb
    balanced = renderer._apply_white_balance(src, wb)
    rec["clahe"] = pipeline.tone(balanced, a)
    expected = renderer._apply_tone(balanced, a, rec["clahe"])
    got = renderer.render(src, a, rec)
    assert np.array_equal(np.asarray(got), np.asarray(renderer._crop_to(expected, rec["crop"])))


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = skipped = 0
    for t in tests:
        try:
            t()
            print(f"  ok    {t.__name__}")
        except Skip as e:
            skipped += 1
            print(f"  SKIP  {t.__name__}: {e}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {t.__name__}: {e}")
    ran = len(tests) - skipped
    print(f"\n{ran - failed}/{ran} passed" + (f", {skipped} skipped" if skipped else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
