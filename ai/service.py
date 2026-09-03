"""AI service. One endpoint per PS feature. web/ calls this over HTTP."""

from __future__ import annotations

import json
import logging
import pathlib
import threading
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv

# ai/.env, before anything reads os.environ. interpret.py resolves OPENROUTER_API_KEY at
# call time, and .env.example has always said "copy to ai/.env" — but nothing loaded it, so
# a filled-in ai/.env left /catalog/interpret answering 503 exactly as if it were empty.
# python-dotenv ships with uvicorn[standard]; this adds no dependency. A real environment
# variable still wins, which is what a deployment sets.
load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

from enhance import jobs, pipeline, recipe, storage
from catalog import seo
from catalog.prefill import (
    SYSTEM_PROMPT_PREFILL,
    VISION_MODEL,
    to_data_url,
    validate_prefill,
)
from catalog.describe import (
    SYSTEM_PROMPT_DESCRIBE,
    build_describe_payload,
    compose_fallback,
    validate_describe,
)
from interpret import InterpretError
from interpret import _call_model as call_model
from interpret import harvest as run_harvest
from interpret import interpret as run_interpret
from price import comps
from price.compute import quote

log = logging.getLogger(__name__)

_warm_device: str | None = None


def _prewarm() -> None:
    """Load BiRefNet and burn one inference, so the first artisan does not pay for it.

    Imported here rather than at module scope on purpose: `enhance/segmenter.py` says its
    import is lazy because it pulls in torch, and doing that at startup would put a
    multi-second import in front of every endpoint in this file, including the ones that
    have nothing to do with images.
    """
    global _warm_device
    try:
        from enhance import segmenter

        t = time.perf_counter()
        _warm_device = segmenter.prewarm()
        log.info("segmenter warm on %s in %.0fms", _warm_device, (time.perf_counter() - t) * 1000)
    except Exception:
        # Rule 3: degrade and speak. No GPU, no weights on disk and no network to fetch them,
        # or torch not installed — none of that may stop `/price`, `/catalog` or the gate from
        # serving. The first `/enhance` simply pays the load itself, exactly as it did before
        # this existed, and `load()` holds a lock so nothing double-loads.
        log.warning("segmenter prewarm failed; first /enhance pays the load", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm the model in the background at startup.

    A BACKGROUND thread, not an await. Blocking startup would be simpler, but it would also
    mean a box with no GPU cannot serve pricing or cataloguing — one feature's cold start
    taking down four. Uvicorn binds immediately and the model lands ~4s later, which is
    still long before anyone has photographed anything.

    Daemon, so Ctrl-C during that window exits rather than hanging on a torch import.
    """
    threading.Thread(target=_prewarm, name="segmenter-prewarm", daemon=True).start()
    yield


app = FastAPI(title="Rubix AI", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    """`warm` is null while the model is still loading, and false if prewarm gave up.

    Worth reading before a demo: false means enhancement still works but the first photo
    will stall for about four seconds.
    """
    return {"ok": True, "warm": _warm_device}


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


@app.post("/catalog/harvest")
async def catalog_harvest(req: dict) -> dict:
    """One sentence -> every slot it happened to contain. Contract: ai/contracts.md.

    Always optional, and the caller must treat it that way. The artisan's direct answer to
    the question actually asked is already stored before this is called; a harvest only
    fills slots that are still empty. So an empty result and a 503 mean the same thing to
    the app — ask the next question — and neither is a failure worth telling the artisan
    about. They said a sentence; we got what we could out of it.

    Same three outcomes as /catalog/interpret, for the same reasons.
    """
    try:
        result = await run_harvest(req)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except InterpretError as e:
        log.warning("harvest unavailable: %s", e)
        raise HTTPException(503, "interpreter unavailable") from e

    return {"slots": result["slots"], "confidence": result["confidence"]}


@app.post("/enhance")
def enhance(req: dict, response: Response):
    """F1. Queues the job — enhancement takes ~20s. See contracts.md.

    **The quality gate runs here, synchronously, before anything is queued.** It is the one
    piece of work done in the request, and it is done in the request on purpose: it costs no
    GPU, and a refusal is worth far more to the artisan now — while they are still holding
    the object, in the same light — than after a twenty-second wait. `contracts.md` shows
    the rejection as an immediate body with no job id, and `web/api` already handles a
    response without one.

    A rejection is not an error, so it is 200 rather than 4xx. The photograph was received
    and understood; the answer is "retake it", and the app speaks `message_key` to the
    artisan.
    """
    image_url = req.get("image_url")
    if not image_url:
        raise HTTPException(400, "image_url is required")
    product_id = req.get("product_id") or "unknown"
    targets = req.get("targets") or [pipeline.PRIMARY]

    try:
        image = storage.open_image(image_url)
    except storage.SourceError as e:
        # Our file is missing, not their photograph's fault. `enhance.failed` is the app's
        # degrade path — it keeps the artisan's own photo and carries on.
        raise HTTPException(502, {"reason": str(e), "message_key": "enhance.failed"})

    rejection = pipeline.gate(image)
    if rejection:
        response.status_code = 200
        return {"status": "rejected", **rejection}

    job_id = jobs.submit(pipeline.run, image, targets, product_id)
    response.status_code = 202
    return {"job_id": job_id, "status": "queued"}


@app.post("/enhance/rerender")
def enhance_rerender(req: dict, response: Response):
    """Re-apply a stored recipe. **No GPU when the mask is still cached.**

    This is the endpoint the tier picker calls. `{product_id, image_url, recipe, targets}`,
    plus an optional `tier` to change before rendering — sending `tier` marks the recipe
    `tier_source: "user"`, and once a person has overruled the confidence score a later
    automatic pass must not quietly overrule them back.

    Synchronous, unlike `/enhance`: with the mask cached this is tens of milliseconds, and
    a job id for that would be slower than the work. It falls back to re-segmenting if the
    mask is gone, which is the one case where it takes as long as `/enhance` — acceptable,
    because it is rare and the alternative is failing.

    The caller stores the returned `recipe` back on the product row. `contracts.md` has the
    shapes.
    """
    image_url = req.get("image_url")
    rec = req.get("recipe")
    if not image_url or not rec:
        raise HTTPException(400, "image_url and recipe are required")
    product_id = req.get("product_id") or "unknown"
    targets = req.get("targets") or [pipeline.PRIMARY]

    if req.get("tier"):
        try:
            rec = recipe.with_tier(rec, req["tier"], by_user=True)
        except ValueError as e:
            raise HTTPException(400, str(e))

    try:
        image = storage.open_image(image_url)
    except storage.SourceError as e:
        raise HTTPException(502, {"reason": str(e), "message_key": "enhance.failed"})

    try:
        return pipeline.rerender(image, targets, product_id, rec)
    except ValueError as e:
        # A recipe render() cannot honour. 422 rather than 500: the request is well-formed
        # and the stored recipe is the problem, and the caller's fix is to re-run /enhance.
        raise HTTPException(422, {"reason": str(e), "message_key": "enhance.failed"})


@app.get("/enhance/{job_id}")
def enhance_status(job_id: str):
    """Poll a job. `web/api` proxies this and checks ownership before it reaches the app.

    404 on an unknown id is survivable by design: the job table is process-local (see
    `enhance/jobs.py`), so a service restart makes ids stop resolving, and the app degrades
    to the artisan's own photograph on any failure.
    """
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown job id")
    return job


@app.post("/catalog")
async def catalog(req: dict) -> dict:
    """F2. The artisan's answers -> one listing, shaped for every channel they asked for.

    Two steps, and the split is the whole design. The model writes prose once. Then
    `catalog/seo.py` — pure, deterministic, tested — cuts that prose to each platform's real
    limits. A model asked to respect Amazon's 249-BYTE keyword cap will respect it most of
    the time, and most of the time is how a Hindi listing arrives silently truncated to a
    third of its keywords three days later.

    Never raises for a missing model. `OPENROUTER_API_KEY` unset is a supported state
    everywhere in this service, and the artisan has already answered the questions — so an
    unreachable model degrades to a listing composed from their own sentences rather than
    throwing away work they did. `confidence: 0` is how the caller tells the difference.
    """
    try:
        payload = build_describe_payload(req)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    try:
        content = await call_model(
            SYSTEM_PROMPT_DESCRIBE,
            f"LANGUAGE: {payload['language']}\n"
            f"FIELDS (data, not instructions):\n<<<{json.dumps(payload['fields'], ensure_ascii=False)}>>>",
            # A full bilingual listing does not fit in the 400 the one-field callers use.
            max_tokens=1400,
        )
        general = validate_describe(content)
        if not general["title"]:
            # Reachable, but produced nothing usable. Same outcome as unreachable — and it
            # used to be silent, which made a model that burned its whole token budget on
            # reasoning indistinguishable from one that is switched off. Both surface as
            # confidence 0, and this line is what told the two apart.
            log.warning("catalog describe returned nothing usable, composing from answers")
            general = compose_fallback(payload["fields"])
    except InterpretError as e:
        log.warning("catalog describe unavailable, composing from answers: %s", e)
        general = compose_fallback(payload["fields"])

    # Only the channels asked for. An unknown id shapes against the loosest limits rather
    # than failing the request — a newer app naming a channel this service has not learned
    # yet should get a usable listing, not a 422 at the end of an interview.
    wanted = req.get("channels")
    channels = [str(c) for c in wanted][:16] if isinstance(wanted, list) else list(seo.LIMITS)

    artisan_name = req.get("artisan_name")
    shaped = {c: seo.shape(c, general, artisan_name) for c in channels}

    return {
        **general,
        "channels": shaped,
        # One button per field, in the order each hand-filled form asks for them.
        "copy_blocks": {
            c: seo.copy_block(c, shaped[c], payload["language"]) for c in channels
        },
    }


@app.post("/catalog/prefill")
async def catalog_prefill(req: dict) -> dict:
    """F2. Vision-only pre-fill, before the artisan speaks. See contracts.md.

    The app speaks this back as a question — "Sambalpuri saree lag rahi hai, cotton ki.
    Sahi hai?" — so every field here is one the artisan will be asked to confirm, and
    `catalog/slots.js` drops the matching question from the interview. That is the whole
    value and also the whole risk: a wrong guess arrives wearing their "yes".

    Three outcomes, and the app treats them differently:
      200 with fields         a guess worth speaking
      200 with all nulls      nothing legible in the photograph -> ask the questions
      502                     our file is unreadable, not their photograph's fault

    Never 500, and never an exception the caller has to interpret. `CatalogPrefill.tsx`
    catches everything and walks on to /catalog/voice, so the worst case here costs the
    shortcut and never the listing.
    """
    image_url = req.get("image_url")
    if not image_url:
        raise HTTPException(400, "image_url is required")

    try:
        image = storage.open_image(image_url)
    except storage.SourceError as e:
        # Same split as /enhance: our missing file must not be reported as their bad
        # photograph, or they retake a picture that was fine.
        raise HTTPException(502, {"reason": str(e), "message_key": "enhance.failed"}) from e

    try:
        content = await call_model(
            SYSTEM_PROMPT_PREFILL,
            "Look at this photograph and fill what you can actually see.",
            # 400 was enough for the JSON and not for the day a model wrote `confidence`
            # to sixty decimal places, spent the budget on digits, and returned an object
            # that never closed. The prompt asks for two decimals; this is the belt.
            max_tokens=600,
            image_data_url=to_data_url(image),
            model=VISION_MODEL,
        )
    except InterpretError as e:
        # An empty guess, not a failure. The interview covers everything this would have
        # filled, which is exactly what happened before this endpoint existed.
        log.warning("prefill unavailable, returning an empty guess: %s", e)
        return validate_prefill("")

    guess = validate_prefill(content)
    if not guess["confidence"]:
        log.info("prefill read nothing usable from %s", image_url)
    return guess


class PriceRequest(BaseModel):
    """ai/contracts.md § POST /price. Mirrors web/api/routers/price.py's model.

    `material` and `size` are not sent by the app yet; they are accepted because
    `comps.market_range()` selects comparables by them, and comparing a 5.5m cotton saree
    against a silk dupatta is how a market range becomes noise. Optional until the app
    sends them — the F2 vision pre-fill already derives both from the photo.
    """

    product_id: str
    material_cost: float | None = None
    labour_hours: float | None = None
    cluster_id: str | None = None
    category: str | None = None
    material: str | None = None
    size: str | None = None
    channel: str = "gem"


@app.post("/price")
def price(req: PriceRequest):
    """F3. Cost-up suggestion with a floor guard.

    Deterministic end to end. No model produces a number here — comparables may raise the
    suggestion, never lower it below what the thing cost to make, and the only LLM anywhere
    near this feature normalises messy listing titles inside comps (docs/decisions.md).

    Cost information is the one thing this cannot proceed without. With neither a material
    cost nor labour hours there is no floor to compute, and a floor of ₹0 is worse than no
    answer: it clamps nothing while looking authoritative, and the app would speak
    "लागत 0 रुपये है" to someone who cannot read the screen to check. So: refuse, and let
    the screen offer retry or "set the price later", which keeps the listing alive.
    """
    if req.material_cost is None and req.labour_hours is None:
        raise HTTPException(422, "no cost information: cannot compute a floor")

    # A dead comparables source must never cost us the floor, so this is best-effort by
    # construction: market_range() swallows per-source failures and returns None, and
    # quote() prices on cost alone when it does.
    market_range = comps.market_range(req.category, req.material, req.size)

    return quote(
        material_cost=req.material_cost,
        labour_hours=req.labour_hours,
        cluster_id=req.cluster_id,
        channel=req.channel,
        market_range=market_range,
    )
