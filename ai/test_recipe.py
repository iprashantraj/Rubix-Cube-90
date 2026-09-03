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

from enhance import metrics, pipeline, recipe, renderer, storage  # noqa: E402

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
