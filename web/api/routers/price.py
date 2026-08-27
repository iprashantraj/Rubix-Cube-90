"""F3 — the Dynamic Pricing Assistant, proxied to the AI service.

This router did not exist. `app/src/screens/Price.jsx:73` has always posted to `/api/price`
and nothing in `web/api` served it, so every pricing request 404'd. The cost-up model in
`ai/price/compute.py` is written and unit-tested (`cd ai && python3 -m pytest test_price.py`
— 5 passing) and the floor guard is the ethical core of the whole feature, and none of it
has ever been reachable from the app. See `docs/app/Pricing.md`.

web/ calls ai/ over HTTP and never imports across that line — they are separate deploy
units, and the AI box has a GPU this one does not. Same `_ai` shape as the enhance and
prefill hops in routers/products.py.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import settings
from ..models import Artisan
from ..security import current_artisan

router = APIRouter()
log = logging.getLogger(__name__)


class PriceRequest(BaseModel):
    """Mirrors `ai/contracts.md` § POST /price.

    `material_cost` and `labour_hours` are optional because the app genuinely does not
    always have them: none of the five cataloger questions asks what the materials cost
    (spec §6.3), so `Price.jsx` sends `material_cost: null` today. The AI service must
    handle that — `floor_price()` currently raises TypeError on None, which is a real bug
    tracked in docs/app/Pricing.md, not something to paper over by inventing a number here.
    A fabricated material cost would move the floor, and the floor is the one figure in
    this feature that must never be guessed.
    """

    product_id: str
    material_cost: float | None = None
    labour_hours: float | None = None
    cluster_id: str | None = None
    category: str | None = None
    channel: str = "gem"


@router.post("/price")
async def price(
    req: PriceRequest,
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    async with httpx.AsyncClient(base_url=settings().ai_base_url, timeout=30) as client:
        try:
            res = await client.post("/price", json=req.model_dump())
            res.raise_for_status()
            return res.json()
        except Exception as e:
            # 503, not 500, and never a fabricated price. The screen speaks
            # `price.unavailable` and lets the artisan set a price themselves — which is
            # worse than a suggestion but is not a wrong suggestion. A made-up number here
            # would be indistinguishable from a real one to someone who cannot read it.
            log.warning("ai /price failed (product=%s): %s", req.product_id, e)
            raise HTTPException(503, "pricing unavailable") from e
