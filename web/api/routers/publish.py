"""POST /publish — the fan-out. Spec §8, architecture §1.

One tap, every ready channel, in parallel. The design rule that matters: each adapter
reports independently and a failure in one must never take another down. A GeM schema
mismatch cannot be allowed to block an ONDC push that would have gone through fine.
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..channels import registry
from ..channels.base import PublishResult
from ..db import get_db
from ..models import Artisan, ChannelStatus, Listing, Product
from ..security import current_artisan

router = APIRouter()

# ponytail: in-process job table, fine for one API worker. Move to Redis when /publish
# runs on more than one process — a second worker would not see these jobs.
JOBS: dict[str, dict] = {}


class PublishRequest(BaseModel):
    product_id: str
    channels: list[str] | None = None


async def _run_one(adapter, product, status) -> PublishResult:
    try:
        return await adapter.render(product, status)
    except Exception as exc:  # noqa: BLE001 - one channel's failure is not the request's
        # message_key, not the exception text: /publish now speaks its per-channel outcome
        # to the artisan, and a Python traceback read aloud in Hindi is worse than silence.
        return PublishResult(
            channel=adapter.id,
            status="failed",
            message_key="error.unknown",
            error=str(exc),
        )


@router.post("/publish")
async def publish(
    req: PublishRequest,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    product = db.get(Product, req.product_id)
    if product is None or product.artisan_id != artisan.id:
        raise HTTPException(404, "product not found")

    statuses = {
        s.channel.value: s
        for s in db.query(ChannelStatus).filter_by(artisan_id=artisan.id).all()
    }
    connected = {cid for cid, s in statuses.items() if s.refresh_token_enc}

    if req.channels:
        adapters = [registry.get(c) for c in req.channels]
    else:
        adapters = registry.one_tap_channels(connected)

    results = await asyncio.gather(
        *(_run_one(a, product, statuses.get(a.id)) for a in adapters)
    )

    for r in results:
        listing = (
            db.query(Listing).filter_by(product_id=product.id, channel=r.channel).one_or_none()
        )
        if listing is None:
            listing = Listing(product_id=product.id, channel=r.channel)
            db.add(listing)
        listing.status = r.status
        listing.external_id = r.external_id
        listing.artifact_url = r.artifact_url
        listing.error = r.error
    db.commit()

    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "status": "done",
        "results": {r.channel: r.__dict__ for r in results},
    }
    return {"job_id": job_id, **JOBS[job_id]}


@router.get("/publish/{job_id}")
def publish_status(job_id: str) -> dict:
    if job_id not in JOBS:
        raise HTTPException(404, "unknown job")
    return JOBS[job_id]
