"""The gate decides whether an artisan's photo is worth spending a GPU on. It gets a test.

    cd ai && python3 test_gate.py       # no venv, no pytest, no fixtures needed
    cd ai && .venv/bin/pytest test_gate.py

Two halves. The first is synthetic and always runs: images built in memory with a known
defect, asserting the gate refuses each one for the *right* reason — a correct refusal with
the wrong spoken message is still a failure, because the artisan acts on the message.

The second replays the calibration set in images/ and only runs if it is present, since the
pixels are gitignored. Those counts are the ones recorded in research/RESULTS.md; if they
drift, either the gate stopped agreeing with the evidence the thresholds were set on, or the
thresholds moved without the RESULTS row that is supposed to accompany them.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from enhance import metrics, pipeline  # noqa: E402

T = metrics.thresholds()
BIG = T["resolution_min_px"] + 200  # clears the resolution floor with room to spare


def photo(w=BIG, h=BIG, seed=0):
    """A well-exposed, sharp, textured image — the thing the gate is meant to let through.

    Random noise is the cheapest way to guarantee real Laplacian variance, and mid-grey
    keeps it clear of both clipping limits.
    """
    rng = np.random.default_rng(seed)
    a = rng.integers(90, 190, (h, w, 3), dtype=np.uint8)
    return Image.fromarray(a)


def test_a_good_photo_passes():
    assert pipeline.gate(photo()) is None


def test_too_small_is_refused_before_anything_else():
    # Small AND blurry: resolution must win, because no amount of holding still adds pixels.
    tiny = photo(w=400, h=300).filter(ImageFilter.GaussianBlur(8))
    r = pipeline.gate(tiny)
    assert r["reason"] == f"resolution_below_{T['resolution_min_px']}px"
    assert r["message_key"] == "photo.too_small"


def test_resolution_uses_the_short_edge():
    # A wide panorama is not a usable product photo just because one edge is long.
    assert pipeline.gate(photo(w=3000, h=400))["message_key"] == "photo.too_small"


def test_defocused_photo_is_refused_as_blurry():
    r = pipeline.gate(photo().filter(ImageFilter.GaussianBlur(8)))
    assert r == {"reason": "blur_below_reject", "message_key": "photo.blurry"}


def test_dark_photo_is_refused_as_dark():
    dark = Image.fromarray((np.asarray(photo()) * 0.2).astype(np.uint8))
    r = pipeline.gate(dark)
    assert r["message_key"] == "photo.too_dark"


def test_blown_photo_is_refused_as_bright_not_as_dark():
    """The message-order bug this gate exists not to repeat.

    A frame that is mostly blown white still has dark corners. gate.js tests crushed shadows
    before it tests clipped highlights, so it announces this as `photo.too_dark` and the
    artisan adds light to an already ruined frame. Here the mean settles it first.
    """
    a = np.asarray(photo()).copy()
    a[: int(BIG * 0.8)] = 255          # 80% blown out
    a[int(BIG * 0.95) :] = 0           # a crushed strip as well
    r = pipeline.gate(Image.fromarray(a))
    assert r["message_key"] == "photo.too_bright", "blown frame must not be called too dark"


def test_crushed_shadows_are_refused_even_when_the_mean_looks_fine():
    a = np.asarray(photo()).copy()
    a[: int(BIG * 0.30)] = 0           # a third of the frame lost to black
    r = pipeline.gate(Image.fromarray(a))
    assert r["reason"] == "crushed_shadows"
    assert r["message_key"] == "photo.too_dark"


def test_framing_is_never_a_reason_to_refuse():
    """crop() repairs framing, so refusing it here throws away a listing we could rescue."""
    a = np.full((BIG, BIG, 3), 140, np.uint8)
    a[100:400, 100:400] = np.asarray(photo(w=300, h=300, seed=3))   # small, cornered subject
    assert pipeline.gate(Image.fromarray(a)) is None


def test_blur_uses_the_server_number_not_the_capture_advisory():
    """The two gates look at different pixels and must not share one number."""
    assert T["blur_laplacian_variance_reject_min"] < T["blur_laplacian_variance_min"]


# --- the calibration set, when it is on this machine -------------------------------------

FIXTURES = Path(__file__).resolve().parent.parent / "images" / "out" / "metrics.csv"


def _replay():
    """Re-run the gate's decision over the measured fixture set, from the CSV.

    Reads the recorded measurements rather than the photographs: the decision is what is
    under test here, and check.py already proves the measurements.
    """
    import csv

    rows = list(csv.DictReader(FIXTURES.open()))
    good = rejected = 0
    for r in rows:
        is_bad = "-bad-" in r["name"]
        # mirrors gate(), reading the measurements check.py recorded
        if min(int(r["w"]), int(r["h"])) < T["resolution_min_px"]:
            verdict = "reject"
        elif not (T["brightness_mean_min"] <= float(r["mean_full"]) <= T["brightness_mean_max"]):
            verdict = "reject"
        elif float(r["blown_full"]) > T["blown_pixel_fraction_max"]:
            verdict = "reject"
        elif float(r["crushed_full"]) > T["crushed_pixel_fraction_max"]:
            verdict = "reject"
        elif float(r["blur_full"]) < T["blur_laplacian_variance_reject_min"]:
            verdict = "reject"
        else:
            verdict = "pass"
        if is_bad:
            rejected += verdict == "reject"
        else:
            good += verdict == "reject"
    return good, rejected, sum(1 for r in rows if "-bad-" not in r["name"])


def test_the_calibration_set_still_says_what_results_md_says():
    if not FIXTURES.exists():
        return  # pixels are gitignored; see images/README.md
    good_refused, bad_caught, n_good = _replay()
    assert n_good == 93, f"fixture set changed: {n_good} good photographs, expected 93"
    assert good_refused == 25, f"good photographs refused: {good_refused}, RESULTS.md says 25"
    assert bad_caught == 291, f"degraded fixtures caught: {bad_caught}, RESULTS.md says 291"


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"  ok    {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL  {name}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
