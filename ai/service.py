"""AI service. One endpoint per PS feature. web/ calls this over HTTP."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from price import comps
from price.compute import quote

app = FastAPI(title="Rubix AI", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True}


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
