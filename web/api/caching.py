"""Conditional GETs. One helper, used by every list endpoint that can afford one.

The artisan is on metered mobile data, frequently 2G, and the app re-asks for the same
catalogue every time a screen is opened. An ETag turns the second and every later ask into
a 304 with no body: a few hundred bytes of headers instead of the whole list. That is the
artisan's money, not our bandwidth bill, which is why it is worth a module.

Deliberately a weak validator computed from the serialised payload rather than a version
column: it is correct for any endpoint without any of them having to maintain a timestamp,
and the cost is serialising a response we were about to serialise anyway.

🔒 Cache-Control is `private` everywhere. These responses are one artisan's products and
one artisan's orders; a shared cache holding them is a data breach with a good excuse.
"""

from __future__ import annotations

import hashlib
import json

from fastapi import Request, Response


def json_etag(payload) -> str:
    """A weak ETag over the response body. Stable across processes, unlike hash()."""
    raw = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return 'W/"' + hashlib.sha256(raw.encode()).hexdigest()[:32] + '"'


def conditional(request: Request, payload, max_age: int = 0) -> Response:
    """The payload, or a 304 when the client already has exactly this.

    `max_age` is how long the app may reuse it without asking at all. Keep it short: this
    is a freshness window during which the artisan can be looking at something that has
    changed, and an order that arrived a minute ago matters to somebody waiting on money.
    """
    etag = json_etag(payload)
    headers = {
        "ETag": etag,
        "Cache-Control": f"private, max-age={max_age}, must-revalidate",
    }

    if request.headers.get("if-none-match") == etag:
        # 304 must carry the validator and no body. The app treats this as "what you have
        # is current" and skips re-rendering entirely — see cachedGet in app/src/api/client.js.
        return Response(status_code=304, headers=headers)

    return Response(
        content=json.dumps(payload, default=str, ensure_ascii=False),
        media_type="application/json",
        headers=headers,
    )
