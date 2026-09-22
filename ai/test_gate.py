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

import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Every gate() call below would otherwise append to the deployment's real observation log.
# Off by default here; the observation tests turn it back on against a disposable file.
os.environ.setdefault("AI_OBSERVE", "0")

from enhance import metrics, observe, pipeline  # noqa: E402

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


# ------------------------------------------------------------------- observation
#
# The gate's numbers are the only record of what real traffic looks like, and they exist for
# a few microseconds unless something writes them down. See enhance/observe.py.


def _observed(image, **env):
    """Run the gate against a disposable log and return the rows it wrote."""
    with tempfile.TemporaryDirectory() as d:
        log = Path(d) / "observe.jsonl"
        before = {k: os.environ.get(k) for k in ("AI_OBSERVE", "AI_OBSERVE_LOG")}
        os.environ["AI_OBSERVE"] = "1"
        os.environ["AI_OBSERVE_LOG"] = str(log)
        os.environ.update({k: v for k, v in env.items()})
        try:
            verdict = pipeline.gate(image, "prod-1")
        finally:
            for k, v in before.items():
                os.environ[k] = v if v is not None else ""
                if v is None:
                    del os.environ[k]
        return verdict, observe.read(log)


def test_an_accepted_photo_is_recorded_too():
    """The refusals are the obvious half. **The accepted photographs are the half that
    decides whether a threshold can move** — lowering a cutoff is only arguable if you know
    the distribution of what already passes."""
    verdict, rows = _observed(photo())
    assert verdict is None
    assert len(rows) == 1, rows
    r = rows[0]
    assert r["verdict"] is None and r["product_id"] == "prod-1"
    assert r["blur"] > 0 and r["mean"] > 0, r


def test_a_refusal_records_which_measurement_refused_it():
    """`message_key` is deliberately coarser than `reason` — the artisan hears "too dark",
    not which of two statistics said so. The log needs the precise one."""
    dark = Image.fromarray(np.full((BIG, BIG, 3), 8, np.uint8))
    verdict, rows = _observed(dark)
    assert verdict["message_key"] == "photo.too_dark"
    assert rows[0]["verdict"] == verdict["reason"], (rows[0], verdict)


def test_a_photo_refused_on_size_still_records_what_it_could_measure():
    """Resolution is checked before anything is measured, so blur and exposure are null
    here. Null, and present — a reader must never have to guess whether a missing field
    means unmeasured or measured-as-zero."""
    _, rows = _observed(photo(w=200, h=200))
    assert rows[0]["verdict"].startswith("resolution_below")
    assert rows[0]["blur"] is None and rows[0]["mean"] is None, rows[0]


def test_observation_can_be_switched_off():
    _, rows = _observed(photo(), AI_OBSERVE="0")
    assert rows == []


def test_a_broken_log_path_cannot_break_the_gate():
    """An enhancement that fails because a log directory is read-only is a far worse
    outcome than a lost row. observe.py swallows everything for this reason."""
    before = os.environ.get("AI_OBSERVE_LOG")
    os.environ["AI_OBSERVE"] = "1"
    os.environ["AI_OBSERVE_LOG"] = "/proc/self/mem/nope/observe.jsonl"
    try:
        assert pipeline.gate(photo()) is None
    finally:
        os.environ["AI_OBSERVE"] = "0"
        if before is None:
            del os.environ["AI_OBSERVE_LOG"]
        else:
            os.environ["AI_OBSERVE_LOG"] = before


def test_a_torn_last_line_does_not_lose_the_rest():
    """A killed process can leave half a row. Losing that one matters much less than being
    unable to read the other fifty thousand."""
    with tempfile.TemporaryDirectory() as d:
        log = Path(d) / "observe.jsonl"
        log.write_text(json.dumps({"event": "gate", "blur": 1}) + "\n{\"event\": \"ga")
        assert len(observe.read(log)) == 1


def test_the_log_lands_beside_the_renders_not_in_tmp():
    """Three files read AI_OUTPUT_DIR and they must resolve to one directory. observe.py
    shipped defaulting to /tmp/rubix-ai-out while storage.py and web/api/config.py had
    already moved to the user data directory — so the log went to the one place systemd
    sweeps. It fails silently by design, which is how that would have stayed hidden.

    The empty-string case is why `or` rather than `.get(name, default)`: an exported but
    empty AI_OUTPUT_DIR is falsy, not absent, and `.get` hands back "" — which puts the log
    in the working directory while the renders go under home."""
    from enhance import storage

    # AI_OBSERVE and AI_OBSERVE_LOG are both set by earlier tests in this file and one of
    # them is deliberately left at "0"; _path() answers None on either, so pin both here.
    keys = ("AI_OUTPUT_DIR", "AI_OBSERVE", "AI_OBSERVE_LOG")
    before = {k: os.environ.get(k) for k in keys}
    try:
        os.environ["AI_OBSERVE"] = "1"
        os.environ.pop("AI_OBSERVE_LOG", None)
        for value in (None, ""):
            if value is None:
                os.environ.pop("AI_OUTPUT_DIR", None)
            else:
                os.environ["AI_OUTPUT_DIR"] = value
            assert observe._path().parent == storage.OUTPUT_DIR, (
                f"AI_OUTPUT_DIR={value!r}: log -> {observe._path().parent}, "
                f"renders -> {storage.OUTPUT_DIR}"
            )
    finally:
        for k, v in before.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


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
