"""The no-S3 publish path: url rewriting and the containment guard.

Run: cd web && api/.venv/bin/python3 api/test_enhanced_local.py

Covers the bug that made this exist — S3 turned off for demo speed meant `file://` urls
survived into the response, `_record_variants` skipped them all, and the artisan was shown
their own unprocessed photo while being told it had been improved.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

ROOT = Path(tempfile.mkdtemp()) / "out"
(ROOT / "prod1").mkdir(parents=True)
(ROOT / "prod1" / "amazon_2000.jpg").write_bytes(b"jpegbytes")
os.environ["AI_OUTPUT_DIR"] = str(ROOT)

# Something readable that lives OUTSIDE the tree, for the traversal cases to aim at.
secret = ROOT.parent / "secret.txt"
secret.write_text("not yours")

from web.api.config import settings  # noqa: E402
from web.api.routers.products import _publish_local, enhanced_file  # noqa: E402
from fastapi import HTTPException  # noqa: E402

settings.cache_clear()
assert Path(settings().ai_output_dir) == ROOT, settings().ai_output_dir

BASE = "http://10.169.219.181:8000/"


def test_rewrites_file_urls():
    images = [{"target": "amazon", "url": (ROOT / "prod1" / "amazon_2000.jpg").as_uri()}]
    _publish_local(images, BASE)
    assert images[0]["url"] == (
        "http://10.169.219.181:8000/api/enhanced/prod1/amazon_2000.jpg"
    ), images[0]["url"]
    # _record_variants only stores http(s), so this is the assertion that the row gets written.
    assert images[0]["url"].startswith("http://")


def test_leaves_already_published_and_missing_alone():
    published = {"target": "gem", "url": "https://cdn.example/x.jpg"}
    missing = {"target": "whatsapp", "url": (ROOT / "prod1" / "nope.jpg").as_uri()}
    outside = {"target": "amazon", "url": secret.as_uri()}
    _publish_local([published, missing, outside], BASE)
    assert published["url"] == "https://cdn.example/x.jpg"
    # Both stay file:// so _record_variants skips them and the raw photo stays primary,
    # rather than a broken url reaching a listing.
    assert missing["url"].startswith("file://")
    assert outside["url"].startswith("file://")


def test_no_base_url_is_a_no_op():
    """No request to derive a host from: degrade, never emit a hostless url."""
    images = [{"target": "amazon", "url": (ROOT / "prod1" / "amazon_2000.jpg").as_uri()}]
    _publish_local(images, "")
    assert images[0]["url"].startswith("file://")


def test_serves_a_file_in_the_tree():
    res = enhanced_file("prod1/amazon_2000.jpg")
    assert str(res.path) == str(ROOT / "prod1" / "amazon_2000.jpg"), res.path
    assert "immutable" in res.headers["cache-control"]


def test_refuses_to_escape_the_tree():
    for path in (
        "../secret.txt",                 # plain traversal
        "prod1/../../secret.txt",        # traversal from a real subdir
        "/etc/passwd",                   # absolute: root / "/etc/passwd" is "/etc/passwd"
        str(secret),                     # absolute, and it definitely exists
        "prod1",                         # a directory is not a file
        "prod1/nope.jpg",                # simply absent
    ):
        try:
            enhanced_file(path)
        except HTTPException as e:
            # Same 404 for "absent" and "outside", so this cannot probe the filesystem.
            assert e.status_code == 404, (path, e.status_code)
        else:
            raise AssertionError(f"served something it should not have: {path}")


def test_symlink_out_of_the_tree_is_refused():
    link = ROOT / "prod1" / "leak.txt"
    link.symlink_to(secret)
    try:
        enhanced_file("prod1/leak.txt")
    except HTTPException as e:
        assert e.status_code == 404
    else:
        raise AssertionError("followed a symlink out of the output tree")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("\nall passed")
