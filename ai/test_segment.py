"""Segmentation, cropping and compositing — the geometry, and the model when available.

    cd ai && python3 test_segment.py    # master-downscale half only, no venv needed
    cd ai && .venv/bin/pytest test_segment.py

Two halves, the same split as `test_gate.py` and for the same reason.

The first half is pure geometry and always runs. It guards `MASTER_LONG_EDGE`, which is not
a performance knob: BiRefNet infers at 1024 square whatever it is given and its mask is then
stretched to fit, so the master's size *is* the edge quality. Feeding it a full-resolution
upload measurably smears fine detail — `research/segmentation/RESULTS.md`, the follow-up
section. A regression here would be silent in every other test and visible in every listing.

The second half needs torch and ~1GB of downloaded weights, so it skips when they are
absent. It checks the shape of the answer, not its quality — quality is not a unit test, it
is 41 photographs and a pair of eyes, and that lives in `research/segmentation/`.
"""

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from enhance import pipeline, segmenter  # noqa: E402

M = segmenter.MASTER_LONG_EDGE


class Skip(Exception):
    """Raised by a test that cannot run here. Reported as a skip, never as a pass — a
    silent pass on an unrun test is how a broken model path survives a green run."""


def _img(w, h):
    return Image.new("RGB", (w, h), (128, 128, 128))


# ---------------------------------------------------------------- master downscale


def test_landscape_upload_is_capped_on_its_long_edge():
    out = segmenter.to_master(_img(4000, 3000))
    assert max(out.size) == M, out.size
    assert out.size == (M, 1500), out.size


def test_portrait_upload_is_capped_on_its_long_edge():
    out = segmenter.to_master(_img(3000, 4000))
    assert max(out.size) == M, out.size
    assert out.size == (1500, M), out.size


def test_aspect_ratio_survives_the_downscale():
    """A stretched product is a misrepresented product (CLAUDE.md rule 1)."""
    src = _img(3840, 5760)
    out = segmenter.to_master(src)
    assert abs(out.size[0] / out.size[1] - src.size[0] / src.size[1]) < 1e-3


def test_small_photo_is_returned_untouched():
    """Never upscale. Enlarging invents detail we are not allowed to invent, and the gate
    has already refused anything under resolution_min_px."""
    src = _img(1200, 900)
    out = segmenter.to_master(src)
    assert out.size == src.size
    assert out is src, "no copy needed when nothing changes"


def test_photo_exactly_at_the_cap_is_untouched():
    src = _img(M, 1200)
    assert segmenter.to_master(src) is src


def test_22mp_fixture_lands_at_the_measured_stretch():
    """textile-pallu-fringe-01 is the largest fixture in seg-v1 and the one the upscale
    follow-up was measured on. 5.6x stretch at full size, 1.95x at the master."""
    out = segmenter.to_master(_img(3840, 5760))
    stretch = max(out.size) / segmenter.INFER_PX
    assert 1.9 <= stretch <= 2.0, stretch


# ------------------------------------------------------------ composite and crop

import numpy as np  # noqa: E402  (pure-geometry half needs it; torch does not)

CANVAS = pipeline.metrics.thresholds()["listing_canvas_px"]
FILL = pipeline.metrics.thresholds()["crop_fill_target"]


def _blob(w, h, box, value=1.0):
    """Alpha with one solid rectangle in it. box = (l, t, r, b)."""
    a = np.zeros((h, w), np.float32)
    l, tp, r, b = box
    a[tp:b, l:r] = value
    return a


def test_product_box_finds_the_rectangle():
    a = _blob(400, 300, (100, 50, 260, 210))
    assert pipeline.product_box(a) == (100, 50, 260, 210)


def test_product_box_ignores_faint_dust_in_the_corner():
    """One alpha-0.01 speck at the frame edge must not drag the box out to meet it —
    that would shrink the real product to a stamp in the middle of the listing."""
    a = _blob(400, 300, (150, 100, 250, 200))
    a[0, 0] = 0.01
    a[299, 399] = 0.01
    assert pipeline.product_box(a) == (150, 100, 250, 200)


def test_product_box_is_none_on_an_empty_mask():
    assert pipeline.product_box(np.zeros((50, 50), np.float32)) is None


def test_crop_plan_scales_the_product_to_the_fill_target():
    a = _blob(2000, 2000, (900, 900, 1100, 1100))     # 200px product
    plan = pipeline.crop_plan(a)
    assert plan["side"] == round(200 / FILL), plan["side"]
    assert not plan["degraded"]


def test_crop_plan_centres_the_square_on_the_product():
    a = _blob(2000, 2000, (100, 100, 300, 500))
    x0, y0, x1, y1 = pipeline.crop_plan(a)["source_box"]
    assert abs((x0 + x1) / 2 - 200) <= 1
    assert abs((y0 + y1) / 2 - 300) <= 1
    assert (x1 - x0) == (y1 - y0), "must be square"


def test_crop_plan_degrades_rather_than_failing_on_an_empty_mask():
    """CLAUDE.md rule 3. A poor listing image beats no listing image."""
    plan = pipeline.crop_plan(np.zeros((1500, 2000), np.float32))
    assert plan["degraded"] and plan["product_box"] is None
    assert plan["side"] == 1500


def test_crop_plan_reports_upscale_for_a_distant_product():
    """The number the caller should turn into a contracts.md warning."""
    a = _blob(2000, 2000, (960, 960, 1040, 1040))     # 80px product, shot from far away
    assert pipeline.crop_plan(a)["upscale"] > 2.0


def test_crop_output_is_the_listing_canvas():
    a = _blob(1500, 2000, (500, 700, 900, 1300))
    out = pipeline.crop(Image.new("RGB", (1500, 2000), (200, 30, 30)), a)
    assert out.size == (CANVAS, CANVAS)


def test_crop_pads_with_white_outside_the_photograph():
    """A product near the frame edge needs a square that runs off the photo. Those pixels
    are white because composite() has already run — see crop()'s docstring."""
    a = _blob(1000, 1000, (0, 400, 120, 600))         # hard against the left edge
    src = pipeline.composite(Image.new("RGB", (1000, 1000), (10, 10, 10)), a)
    out = pipeline.crop(src, a)
    px = out.load()
    assert px[2, 2] == (255, 255, 255), px[2, 2]


def test_crop_preserves_aspect_ratio():
    """Rule 1: a saree stretched to fit a square is a misrepresented saree."""
    a = _blob(2000, 2000, (800, 400, 1200, 1600))     # 1:3 product
    plan = pipeline.crop_plan(a)
    l, tp, r, b = plan["product_box"]
    scale = CANVAS / plan["side"]
    assert abs(((r - l) * scale) / ((b - tp) * scale) - (r - l) / (b - tp)) < 1e-6


def test_composite_makes_background_exactly_white():
    """Not 252. Marketplaces sample pixels and reject near-white."""
    a = _blob(200, 200, (50, 50, 150, 150))
    out = pipeline.composite(Image.new("RGB", (200, 200), (7, 90, 200)), a)
    px = out.load()
    assert px[0, 0] == (255, 255, 255)
    assert px[100, 100] == (7, 90, 200), "product pixels must be untouched"


def test_composite_blends_the_soft_edge():
    a = _blob(100, 100, (20, 20, 80, 80), value=0.5)
    out = np.asarray(pipeline.composite(Image.new("RGB", (100, 100), (0, 0, 0)), a))
    assert out[50, 50].tolist() == [128, 128, 128], out[50, 50]


def test_composite_rejects_a_mismatched_alpha():
    """A transposed mask composites the product against its own background and looks
    almost right. Fail loudly instead."""
    img = Image.new("RGB", (100, 50))                  # PIL size is (w, h)
    assert np.asarray(img).shape[:2] == (50, 100)      # numpy shape is (h, w) — easy to invert
    try:
        pipeline.composite(img, np.zeros((100, 50), np.float32))   # transposed
    except ValueError:
        return
    raise AssertionError("mismatched alpha was accepted")


# --------------------------------------------------------- confidence and tiers


def test_components_counts_separate_blobs():
    a = np.zeros((60, 60), bool)
    a[5:15, 5:15] = True
    a[40:50, 40:50] = True
    n, sizes = pipeline._components(a)
    assert n == 2, n
    assert sizes == [100, 100], sizes


def test_components_joins_an_L_shape():
    """Two runs that only touch through a corner turn are one object."""
    a = np.zeros((40, 40), bool)
    a[10:30, 10:14] = True
    a[26:30, 10:34] = True
    n, _ = pipeline._components(a)
    assert n == 1, n


def test_components_on_empty():
    assert pipeline._components(np.zeros((20, 20), bool)) == (0, [])


def test_clean_mask_is_tier_a():
    a = _blob(1000, 1000, (300, 300, 700, 700))
    name, score, _ = pipeline.tier(a)
    assert name == "A" and score == 1.0, (name, score)


def test_one_anomaly_demotes_to_b_not_c():
    """A single odd measurement is usually an odd photograph, not a broken mask. Refusing
    to enhance on one signal would cost more listings than it saves."""
    a = _blob(1000, 1000, (490, 490, 510, 510))
    name, score, _ = pipeline.tier(a)
    assert name == "B" and score == 0.7, (name, score)


def test_mask_covering_almost_nothing_is_demoted():
    """textile-shawl-fringe-03: cream linen on white, the cloth was thrown away."""
    a = _blob(1000, 1000, (490, 490, 510, 510))       # 0.04% of frame
    name, score, _ = pipeline.tier(a)
    assert name != "A", (name, score)


def test_mask_covering_almost_everything_is_demoted():
    """291e88c5: a close-up where the fabric fills the frame. There is no figure and
    ground to separate, so a confident mask over ~everything means the same as one over
    ~nothing."""
    a = _blob(1000, 1000, (10, 10, 990, 990))
    name, _, _ = pipeline.tier(a)
    assert name != "A", name


def test_fragmented_mask_is_demoted():
    """A museum case of many objects, a shop of stacked textiles."""
    a = np.zeros((1000, 1000), np.float32)
    for i in range(5):
        a[50 + i * 170:170 + i * 170, 50 + i * 170:170 + i * 170] = 1.0
    _, _, s = pipeline.tier(a)
    assert s["blobs"] > pipeline.metrics.thresholds()["mask_blob_count_max"], s


def test_a_few_loose_specks_are_not_fragmentation():
    """A tassel sheds pixels. That is the mask being right, not broken."""
    a = _blob(1000, 1000, (300, 300, 700, 700))
    a[10, 10] = a[20, 900] = a[900, 20] = a[950, 950] = 1.0
    name, _, s = pipeline.tier(a)
    assert s["blobs"] == 1, s
    assert name == "A", name


def test_tier_c_returns_the_photograph_untouched():
    """The safety net. It removes nothing, so it cannot damage the product — which is why
    it does not blur the background either, see apply_tier()."""
    # C needs two anomalies at once (see tier()): five separate pieces, covering well
    # under mask_area_min between them.
    a = np.zeros((400, 400), np.float32)
    for i in range(5):
        a[10 + i * 76:70 + i * 76, 10 + i * 76:70 + i * 76] = 1.0   # 5 pieces, 5.6% total
    src = Image.new("RGB", (400, 400), (12, 34, 56))
    out, name, score, _ = pipeline.apply_tier(src, a)
    assert name == "C", (name, score)
    assert np.array_equal(np.asarray(out), np.asarray(src))


def test_tier_a_composites_onto_white():
    a = _blob(600, 600, (150, 150, 450, 450))
    out, name, _, _ = pipeline.apply_tier(Image.new("RGB", (600, 600), (9, 9, 9)), a)
    assert name == "A"
    assert out.load()[5, 5] == (255, 255, 255)


def test_tier_b_feathers_the_edge():
    """Same mask, softer boundary — more partly-transparent pixels than tier A would give."""
    a = _blob(1000, 1000, (10, 10, 990, 990))        # area ~0.96 -> B
    out, name, _, _ = pipeline.apply_tier(Image.new("RGB", (1000, 1000), (0, 0, 0)), a)
    assert name == "B", name
    arr = np.asarray(out).mean(axis=2)
    assert ((arr > 5) & (arr < 250)).any(), "no feathered pixels found"


# --------------------------------------------------------------------------- matte


def test_matte_returns_the_mask_it_was_given():
    """Documented as a deliberate no-op, not an oversight — see pipeline.matte()."""
    sentinel = object()
    assert pipeline.matte(_img(10, 10), sentinel) is sentinel


# --------------------------------------------------------------- the model itself


def _model_available():
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def test_alpha_has_the_shape_the_pipeline_expects():
    """Downstream stages index the mask against the image. A transposed or wrongly-scaled
    alpha would compose the product against its own background and look almost right."""
    if not _model_available():
        raise Skip("no torch/transformers")
    import numpy as np

    src = _img(1200, 800)
    a = pipeline.segment(src)
    assert a.shape == (src.height, src.width), (a.shape, src.size)
    assert a.dtype == np.float32, a.dtype
    assert 0.0 <= float(a.min()) and float(a.max()) <= 1.0, (a.min(), a.max())


def test_alpha_is_soft_not_binary():
    """The reason matte() is a no-op. If this ever fails, the no-op stops being justified
    and RESULTS.md's fringe argument needs redoing."""
    if not _model_available():
        raise Skip("no torch/transformers")
    import numpy as np

    fixture = Path(__file__).resolve().parent.parent / "images" / "raw" / "textile-tassel-fringe-01.jpg"
    if not fixture.exists():
        raise Skip("fixture pixels are gitignored")
    a = pipeline.segment(segmenter.to_master(Image.open(fixture).convert("RGB")))
    soft = float(np.count_nonzero((a > 0.05) & (a < 0.95)) / a.size)
    assert soft > 0.005, f"alpha looks binary ({soft:.4%} soft) — matte() no-op is unsafe"


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
    tail = f", {skipped} skipped" if skipped else ""
    print(f"\n{ran - failed}/{ran} passed{tail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
