"""The `load` listener that strips an embedded host off enhanced image urls.

Run: cd web && api/.venv/bin/python3 api/test_image_url_host.py

Tests the regex directly rather than through a database: the rule is what matters, and the
dangerous failure is not "it did not strip" — it is "it stripped something it should not
have", which would turn a working S3 url into a relative path that resolves nowhere.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from web.api.models import _LOCAL_ENHANCED_HOST  # noqa: E402

strip = lambda url: _LOCAL_ENHANCED_HOST.sub("", url)  # noqa: E731


def test_strips_the_host_that_broke_the_demo():
    assert strip("http://10.169.219.181:8000/api/enhanced/p/amazon_2000.jpg") == (
        "/api/enhanced/p/amazon_2000.jpg"
    )
    # Any host, not just the one we happened to hit — the next lease is a different number.
    assert strip("http://172.29.32.131:8000/api/enhanced/p/x.jpg") == "/api/enhanced/p/x.jpg"
    assert strip("https://localhost:8000/api/enhanced/p/x.jpg") == "/api/enhanced/p/x.jpg"


def test_idempotent():
    once = strip("http://10.169.219.181:8000/api/enhanced/p/x.jpg")
    assert strip(once) == once, "a second pass changed an already-relative url"


def test_leaves_everything_else_alone():
    """The failure that would actually cost something.

    `/api/enhanced/` must be required. Without that lookahead this eats the host off every
    S3 and CDN url in the table, and a relative S3 path resolves to nothing at all.
    """
    for url in (
        "https://cdn.example/x.jpg",                       # a real CDN
        "https://bucket.s3.ap-south-1.amazonaws.com/p.jpg",  # what S3 mode writes
        "https://host/api/other/x.jpg",                    # our API, different route
        "https://host/enhanced/x.jpg",                     # no /api prefix
        "file:///tmp/out/p/x.jpg",                         # an unpublished render
        "/api/enhanced/p/x.jpg",                           # already relative
        "",
    ):
        assert strip(url) == url, url


def test_only_matches_at_the_start():
    """Anchored, so a host-like string inside a path is not a match."""
    url = "/api/enhanced/p/http://10.0.0.1:8000/api/enhanced/x.jpg"
    assert strip(url) == url


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("\nall passed")
