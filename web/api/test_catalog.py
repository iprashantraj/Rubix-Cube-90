"""The /catalog proxy: what crosses to the AI service, and what comes back.

Needs the venv (fastapi, httpx). No database, no AI service, no network:

    web/api/.venv/bin/python -m pytest web/api/test_catalog.py

The route is thin on purpose, so only the two things it actually decides are tested: the
seller name comes from the session rather than the request body, and the response is rebuilt
field by field instead of forwarded. Both are the kind of thing that breaks silently.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

from .main import app
from .security import current_artisan


class _Artisan:
    display_name = "Utsav Mohanty"


@pytest.fixture
def sent(monkeypatch):
    """Capture the payload the route posts, and answer with a canned AI response."""
    seen = {}

    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            seen["url"], seen["payload"] = url, json
            return httpx.Response(200, json=seen.get("reply", {"title": "A saree"}))

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    app.dependency_overrides[current_artisan] = lambda: _Artisan()
    yield seen
    app.dependency_overrides.clear()


def _post(body):
    return TestClient(app).post("/api/catalog", json=body)


def test_the_seller_name_comes_from_the_session_not_the_body(sent):
    # A caller-supplied name would strip a stranger's name out of somebody else's listing.
    _post({"fields": {"what": "saree"}, "artisan_name": "Somebody Else"})
    assert sent["payload"]["artisan_name"] == "Utsav Mohanty"


def test_only_the_envelope_crosses(sent):
    _post({"fields": {"what": "saree"}, "language": "hi", "token": "secret", "id": 7})
    assert set(sent["payload"]) == {"fields", "language", "artisan_name"}


def test_the_response_is_rebuilt_not_forwarded(sent):
    # A new field on the AI side must not reach the app without somebody editing the route.
    sent["reply"] = {"title": "A saree", "desc_hi": "एक साड़ी।", "surprise": "x"}
    body = _post({"fields": {"what": "saree"}}).json()

    assert "surprise" not in body
    assert body["desc_hi"] == "एक साड़ी।", "Devanagari survives the round trip"
    assert body["keywords"] == [] and body["copy_blocks"] == {}, "absent fields are empty"


def test_an_unreachable_ai_service_is_503(sent, monkeypatch):
    # 503 and not 500: the app treats it as non-fatal and publishes the listing anyway.
    class _Dead:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "AsyncClient", _Dead)
    assert _post({"fields": {"what": "saree"}}).status_code == 503
