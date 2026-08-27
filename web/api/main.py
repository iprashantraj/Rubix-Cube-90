"""Kaarigar API.

Surfaces: the artisan app (Capacitor), the admin console and the public marketplace
(Next.js). The AI service is a separate deploy unit reached over HTTP — see ai/.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import (
    artisans,
    auth,
    channels,
    marketplace,
    orders,
    price,
    products,
    publish,
    thresholds,
    uploads,
    voice,
)

app = FastAPI(title="Kaarigar API", version="0.1.0")

log = logging.getLogger("kaarigar.api")


@app.middleware("http")
async def error_envelope(request: Request, call_next):
    """Turn an unhandled exception into a real 500 response, below the CORS layer.

    ⚠️ Order matters and it is the opposite of what it looks like. `add_middleware` inserts
    at the front of the list and the stack is built in reverse, so the LAST middleware
    registered ends up OUTERMOST. This one is registered first on purpose, so CORSMiddleware
    below wraps it and gets to add its headers to whatever comes out of here.

    Why it exists, because the failure it prevents cost an afternoon:

    Starlette's ServerErrorMiddleware sits above every user middleware, including CORS. So
    an unhandled exception produced a bare 500 with no `Access-Control-Allow-Origin` on it.
    The browser cannot see a response it is not allowed to read, so it reported the only
    thing it knew — "blocked by CORS policy" — and the app's fetch wrapper turns any
    rejected fetch into `net.offline`. A missing table in a dev database therefore reached
    an artisan as "no network", on a phone with full signal, with a correct CORS config and
    a reachable server. Three layers of lying about one broken query.

    Catching here means the app gets a readable 500 with a `message_key` it can speak, and
    whoever is debugging gets the traceback in the server log where it belongs.
    """
    try:
        return await call_next(request)
    except Exception:
        # exc_info rather than str(e): the traceback is the entire value of this log line.
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            # The app speaks message_key in the artisan's language. It is deliberately not
            # the exception text — that is English, technical, and often a SQL statement.
            content={"message_key": "error.unknown", "detail": "internal error"},
        )


app.add_middleware(
    CORSMiddleware,
    # Capacitor serves the app from https://localhost, so it is a cross-origin caller.
    allow_origins=["https://localhost", "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    auth, artisans, uploads, products, publish, channels,
    orders, marketplace, thresholds, voice, price,
):
    app.include_router(r.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "env": settings().environment}
