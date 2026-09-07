"""The /enhance contract, end to end.

    cd ai && .venv/bin/pytest test_service.py
    cd ai && python3 test_service.py        # skips: needs fastapi

Unlike `test_gate.py` and `test_segment.py` this one cannot run on a bare machine — it is
testing the HTTP surface, so it needs fastapi. The halves that need a GPU are marked and
skip separately, so the contract's error paths stay checkable on a laptop with no CUDA.

What is worth testing here is not that a photograph comes out pretty. It is that every
branch `web/api` and the app can hit returns the shape `contracts.md` promises, including
the unhappy ones — the app degrades to the artisan's own photo on failure, and it can only
do that if failures arrive in the shape it expects.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# This drives the whole pipeline; it must not append to a real observation log.
os.environ.setdefault("AI_OBSERVE", "0")

HERE = Path(__file__).resolve().parent
RAW = HERE.parent / "images" / "raw"


class Skip(Exception):
    pass


def _client():
    try:
        from fastapi.testclient import TestClient
    except ImportError:
        raise Skip("fastapi not installed")
    import service

    return TestClient(service.app)


def _torch():
    try:
        import torch  # noqa: F401
    except ImportError:
        return False
    return True


def _fixture(name):
    p = RAW / name
    if not p.exists():
        raise Skip("fixture pixels are gitignored")
    return f"file://{p}"


# ------------------------------------------------------------------ error paths


def test_health():
    assert _client().get("/health").json() == {"ok": True}


def test_missing_image_url_is_400():
    assert _client().post("/enhance", json={}).status_code == 400


def test_unreadable_source_is_502_not_a_photo_complaint():
    """Our missing file must not be reported as the artisan's bad photograph. They would
    retake a picture that was fine."""
    r = _client().post("/enhance", json={"image_url": "file:///definitely/not/here.jpg"})
    assert r.status_code == 502, r.status_code


def test_s3_scheme_says_what_is_wrong():
    r = _client().post("/enhance", json={"image_url": "s3://raw/abc.jpg"})
    assert r.status_code == 502
    assert "s3" in str(r.json()).lower()


def test_unknown_job_id_is_404():
    assert _client().get("/enhance/j_nothing").status_code == 404


def test_gate_rejection_is_2xx_with_a_message_key():
    """A refusal is an answer, not an error. `contracts.md` gives it no job id, and
    `web/api` already handles a response without one."""
    from PIL import Image

    small = HERE / "_tiny.jpg"
    Image.new("RGB", (200, 200), (120, 120, 120)).save(small)
    try:
        r = _client().post("/enhance", json={"image_url": f"file://{small}"})
        assert r.status_code == 200, r.status_code
        body = r.json()
        assert body["status"] == "rejected"
        assert body["message_key"] == "photo.too_small"
        assert "job_id" not in body
    finally:
        small.unlink(missing_ok=True)


# ------------------------------------------------------------- the whole path


def _run(url, targets=("amazon", "whatsapp")):
    import time

    c = _client()
    r = c.post("/enhance", json={"product_id": "p_test", "image_url": url,
                                 "targets": list(targets)})
    assert r.status_code == 202, (r.status_code, r.json())
    jid = r.json()["job_id"]
    for _ in range(240):
        body = c.get(f"/enhance/{jid}").json()
        if body.get("status") in ("done", "failed"):
            return body
        time.sleep(0.5)
    raise AssertionError("job never finished")


def test_a_good_photo_produces_every_target():
    if not _torch():
        raise Skip("no torch")
    body = _run(_fixture("a4a1cece-21bc-4bc4-b445-2eaa42bb44f1.jpeg"))
    assert body["status"] == "done", body
    got = {i["target"]: i for i in body["images"]}
    assert set(got) == {"amazon", "whatsapp"}
    assert got["amazon"]["width"] == 2000 and got["whatsapp"]["width"] == 1000
    assert sum(i["is_primary"] for i in body["images"]) == 1, "exactly one primary"


def test_response_says_which_stages_ran():
    """Rule 2's recipe starts here, and the unwritten stages are named rather than
    quietly absent."""
    if not _torch():
        raise Skip("no torch")
    body = _run(_fixture("a4a1cece-21bc-4bc4-b445-2eaa42bb44f1.jpeg"), ("amazon",))
    assert "segment" in body["stages"]
    assert "white_balance" in body["stages"], "white balance is written now"
    assert "denoise_sharpen" in body["skipped"]


def test_a_demoted_mask_warns_in_words_an_artisan_hears():
    """Tier B/C must reach the app as a spoken warning, not a silent difference."""
    if not _torch():
        raise Skip("no torch")
    body = _run(_fixture("textile-shawl-fringe-03.jpg"), ("amazon",))
    assert body["tier"] in ("B", "C"), body["tier"]
    assert body["warnings"], "a demoted tier must warn"


def test_exported_file_is_white_cornered_and_carries_no_exif():
    """Rule 5 is unconditional, and this is a second place bytes are written."""
    if not _torch():
        raise Skip("no torch")
    from urllib.parse import urlparse
    from PIL import Image

    body = _run(_fixture("a4a1cece-21bc-4bc4-b445-2eaa42bb44f1.jpeg"), ("amazon",))
    p = Path(urlparse(body["images"][0]["url"]).path)
    im = Image.open(p)
    assert len(im.getexif()) == 0, "EXIF survived the re-encode"
    px = im.load()
    assert px[0, 0] == (255, 255, 255), px[0, 0]


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
