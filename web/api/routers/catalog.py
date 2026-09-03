"""Catalog interpretation — a thin proxy to the AI service.

Two boundaries meet here and both are deliberate.

**The app never holds the OpenRouter key.** A key shipped in a mobile bundle is a published
key; anyone with the APK has it, and rotating it means an app release rural users never
install. So the phone calls us, we call `ai/`, and `ai/` holds the credential.

**`web/` calls `ai/` over HTTP and never imports across that line** (see the repo README).
They are separate deploy units. This module therefore forwards a request and shapes the
failure; it contains no interpretation logic and must not grow any.

What it does add is the second half of the data guarantee. `ai/interpret.py` allowlists the
fields it will send onward; this allowlists the fields that leave the phone's request in the
first place. Two independent filters, because the artisan's session is in scope HERE — this
process has their token, their id, their phone number — and none of it has any business
reaching a third-party model. See `docs/app/AI-Data-Flow.md`.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..security import current_artisan

router = APIRouter()
log = logging.getLogger(__name__)

# Exactly what may cross to the AI service. Rebuilt field by field rather than forwarded as
# a blob: `req` is a dict the phone controls, and passing it through would mean the app —
# or anything that could reach this endpoint — decides what a third party receives.
FORWARDED_FIELDS = ("transcript", "question", "options", "language")

# The harvest envelope, kept separate from FORWARDED_FIELDS on purpose. `slots` is a list of
# field names where `question` is a single id, so the two shapes are genuinely different and
# a single tuple covering both would let a harvest smuggle a `question` or an interpret call
# smuggle `slots`. Mirrors ALLOWED_HARVEST_FIELDS in ai/interpret.py — this is the outer half
# of the same two-filter guarantee, and neither half trusts the other to have run.
HARVEST_FIELDS = ("transcript", "slots", "language")

TIMEOUT_SECONDS = 15

# Composing a full bilingual listing is a 1400-token generation where the one-field callers
# ask for 400, so it takes measurably longer. 15s times out mid-write and the artisan sees a
# fallback listing that the model was, in fact, about to produce properly.
COMPOSE_TIMEOUT_SECONDS = 45


@router.post("/catalog/interpret")
async def catalog_interpret(req: dict, artisan=Depends(current_artisan)) -> dict:
    """Extract one field value from what the artisan said. Contract: ai/contracts.md.

    Authenticated: this spends money per call, so it is not an open relay to an LLM. The
    artisan is identified for rate-limiting and abuse purposes only — their id is used HERE
    and is deliberately not forwarded (see FORWARDED_FIELDS).
    """
    payload = {k: req.get(k) for k in FORWARDED_FIELDS if req.get(k) is not None}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            res = await client.post(
                f"{settings().ai_base_url}/catalog/interpret",
                json=payload,
            )
    except httpx.HTTPError as e:
        # The AI service is optional infrastructure. The app has a local synonym tier and a
        # visual fallback for exactly this, so an unreachable interpreter degrades the
        # experience rather than blocking onboarding.
        log.warning("ai service unreachable for interpret: %s", e)
        raise HTTPException(503, "interpreter unavailable") from e

    if res.status_code == 422:
        # A malformed request is our bug, not the artisan's. Surface it as-is in dev.
        raise HTTPException(422, res.text)
    if res.status_code != 200:
        log.warning("ai interpret returned %s: %s", res.status_code, res.text[:200])
        raise HTTPException(503, "interpreter unavailable")

    body = res.json()
    # Re-shaped rather than passed through, so a change on the AI side cannot silently
    # introduce a new field into the app's response.
    return {"choice": body.get("choice"), "confidence": body.get("confidence", 0.0)}


@router.post("/catalog/harvest")
async def catalog_harvest(req: dict, artisan=Depends(current_artisan)) -> dict:
    """Pull every slot one spoken sentence contains. Contract: ai/contracts.md.

    Asked what a thing is, an artisan says "yeh sambalpuri cotton saree hai, teen din laga".
    That is four answers in one breath, and asking for three of them again is the largest
    single waste in the interview.

    Authenticated for the same reason as interpret: it spends money per call. The artisan's
    id is used HERE and forwarded nowhere — see HARVEST_FIELDS, and the self-check in
    ai/interpret.py that asserts a whole draft handed to the builder yields three fields.

    A failure is not surfaced to the artisan. They have already answered the question that
    was actually asked and that answer is already stored; a harvest that returns nothing
    just means the next question gets asked, which is what used to happen every time.
    """
    payload = {k: req.get(k) for k in HARVEST_FIELDS if req.get(k) is not None}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            res = await client.post(
                f"{settings().ai_base_url}/catalog/harvest",
                json=payload,
            )
    except httpx.HTTPError as e:
        log.warning("ai service unreachable for harvest: %s", e)
        raise HTTPException(503, "harvest unavailable") from e

    if res.status_code == 422:
        raise HTTPException(422, res.text)
    if res.status_code != 200:
        log.warning("ai harvest returned %s: %s", res.status_code, res.text[:200])
        raise HTTPException(503, "harvest unavailable")

    body = res.json()
    found = body.get("slots")
    # Re-shaped, and re-checked. `slots` crossed a process boundary as arbitrary JSON, so it
    # is rebuilt as a flat string map here rather than handed to the app as it arrived.
    slots = (
        {str(k): str(v) for k, v in found.items() if isinstance(v, (str, int, float))}
        if isinstance(found, dict)
        else {}
    )
    return {"slots": slots, "confidence": body.get("confidence", 0.0)}


# The compose envelope. `fields` is a dict of product facts, not a single transcript, so it
# is a third shape and gets a third tuple for the reason the other two are separate.
#
# `artisan_name` is accepted but NOT taken from the request — see below. `channels` is a
# list of ids the app wants shaped; absent means every channel the AI service knows.
COMPOSE_FIELDS = ("fields", "language", "channels")


@router.post("/catalog")
async def catalog(req: dict, artisan=Depends(current_artisan)) -> dict:
    """The answers become one listing, shaped for every channel. Contract: ai/contracts.md.

    Last step of the interview, and the only thing that produces `copy_blocks` — the
    per-field buttons /publish shows for the channels an artisan fills in by hand. Without
    this route the review screen asked them to approve empty fields.

    The AI service never raises for a missing model: it composes the listing from the
    artisan's own answers and marks it `confidence: 0`. So a 503 from here means we could
    not reach that service at all, and the app treats it as non-fatal because the listing
    is already saved before this is called. Rule 3 — losing F2 costs a better description,
    never the listing.

    `fields` is forwarded as the app sent it. It is a dict this process does not inspect,
    and the filtering that matters happens in ai/catalog/describe.py, whose allowlist is
    field-by-field and drops anything that is not a product fact — cost and price included.
    Duplicating that list here would give us two places to forget the same thing.
    """
    payload = {k: req.get(k) for k in COMPOSE_FIELDS if req.get(k) is not None}

    # From the session, never from the request body. This name only ever gets SUBTRACTED —
    # seo.strip_seller_identity removes it from copy destined for channels that forbid
    # seller identity in a description — so a caller-supplied name is at best useless and at
    # worst strips a stranger's name out of somebody else's listing. It reaches ai/ and stops
    # there; build_describe_payload does not forward it to any model.
    if artisan.display_name:
        payload["artisan_name"] = artisan.display_name

    try:
        async with httpx.AsyncClient(timeout=COMPOSE_TIMEOUT_SECONDS) as client:
            res = await client.post(f"{settings().ai_base_url}/catalog", json=payload)
    except httpx.HTTPError as e:
        log.warning("ai service unreachable for catalog: %s", e)
        raise HTTPException(503, "cataloguer unavailable") from e

    if res.status_code == 422:
        raise HTTPException(422, res.text)
    if res.status_code != 200:
        log.warning("ai catalog returned %s: %s", res.status_code, res.text[:200])
        raise HTTPException(503, "cataloguer unavailable")

    body = res.json()

    def _strings(value) -> list:
        return [str(v) for v in value][:64] if isinstance(value, list) else []

    # Re-shaped like the other two, so a new field on the AI side cannot appear in the app's
    # response without somebody editing this line. `channels` and `copy_blocks` are passed
    # as-is: they are keyed by channel id, and re-deriving their inner shape here would mean
    # this file learning each platform's field list — which is exactly what ai/catalog/seo.py
    # owns and this proxy must not grow.
    return {
        "title": str(body.get("title") or ""),
        "desc_en": str(body.get("desc_en") or ""),
        "desc_hi": str(body.get("desc_hi") or ""),
        "short_desc": str(body.get("short_desc") or ""),
        "keywords": _strings(body.get("keywords")),
        "bullets": _strings(body.get("bullets")),
        "confidence": body.get("confidence", 0.0),
        "channels": body.get("channels") or {},
        "copy_blocks": body.get("copy_blocks") or {},
    }
