"""AI service. One endpoint per PS feature. web/ calls this over HTTP."""

import logging

from fastapi import FastAPI, HTTPException

from interpret import InterpretError
from interpret import interpret as run_interpret

app = FastAPI(title="Rubix AI", version="0.1.0")
log = logging.getLogger(__name__)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/catalog/interpret")
async def catalog_interpret(req: dict) -> dict:
    """Free speech -> one field value. Contract: ai/contracts.md.

    The only endpoint in this file that is implemented, because it is the only one whose
    absence actively corrupts data: without it the app stores "मेरा नाम उत्सव है" verbatim
    into `display_name`.

    Three outcomes, and the difference matters to the caller:
      200 {"choice": "...", "confidence": n}  understood
      200 {"choice": null,  "confidence": 0}  reachable, did not understand -> app falls back
      503                                     unconfigured or unreachable   -> app falls back

    422 is reserved for a malformed request, which is a bug in the caller — not something
    an artisan can cause by saying an unusual sentence.
    """
    try:
        result = await run_interpret(req)
    except ValueError as e:
        # build_payload refused it: unknown question id, empty transcript, missing options.
        raise HTTPException(422, str(e)) from e
    except InterpretError as e:
        # No key, or OpenRouter unreachable. A supported state — see interpret.py.
        log.warning("interpret unavailable: %s", e)
        raise HTTPException(503, "interpreter unavailable") from e

    # `choice`, not `value`, because that is what ai/contracts.md already publishes and what
    # app/src/voice/interpret.js already reads.
    return {"choice": result["value"], "confidence": result["confidence"]}


@app.post("/enhance")
def enhance(req: dict):
    """F1. Queues the job — enhancement takes ~20s. See contracts.md."""
    raise NotImplementedError


@app.get("/enhance/{job_id}")
def enhance_status(job_id: str):
    raise NotImplementedError


@app.post("/catalog")
def catalog(req: dict):
    """F2. Voice note -> listing in English and Hindi."""
    raise NotImplementedError


@app.post("/catalog/prefill")
def catalog_prefill(req: dict):
    """F2. Vision-only pre-fill, before the artisan speaks."""
    raise NotImplementedError


@app.post("/price")
def price(req: dict):
    """F3. Cost-up suggestion with a floor guard."""
    raise NotImplementedError
