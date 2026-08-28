"""POST /publish — the fan-out. Spec §8, architecture §1.

One tap, every ready channel, in parallel. The design rule that matters: each adapter
reports independently and a failure in one must never take another down. A GeM schema
mismatch cannot be allowed to block an ONDC push that would have gone through fine.
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..channels import registry
from ..channels.base import PublishResult
from ..db import get_db
from ..models import Artisan, ChannelStatus, Listing, Product
from ..security import current_artisan

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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
        # 🐞 `error` used to take only `r.error`, and every preflight refusal carries a
        # `message_key` with `error` left None. So the most common failure in the whole
        # system — no image attached, colour not confirmed — was written to the database as
        # status='failed', error=NULL, and there was no way to tell from the data which of
        # the two it had been. Nine rows of that is what "publishing does not work and
        # nothing says why" looked like from the inside.
        listing.error = r.error or r.message_key
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


@router.get("/publish/gem/{product_id}.xlsx")
def gem_workbook(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> Response:
    """The GeM catalogue sheet, built on demand.

    ⚠️ This route is why GeM "file generation" did not work. `GeMAdapter.render` built the
    workbook, threw the bytes away, and returned `artifact_url=f"s3://gem/{id}.xlsx"` — a
    string composed on the spot, pointing at an object nobody had written, in a bucket
    scheme nothing in this repo produces. The artisan was told their file was ready and
    there was no file.

    Built on request rather than stored, deliberately. The sheet is a pure function of the
    product, so a saved copy is a cache with no invalidation: edit the title, and the
    download still serves the old one. Regenerating costs milliseconds — openpyxl over one
    row — and is always right. If it ever stops being cheap, cache it against
    `product.updated_at` and not before.

    Ownership is enforced by the query, not checked afterwards: a product id belonging to
    someone else is a 404 here, and 404 rather than 403 because "does this id exist" is not
    a question a stranger gets to have answered.
    """
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.artisan_id == artisan.id)
        .first()
    )
    if product is None:
        raise HTTPException(404, "unknown product")

    adapter = registry.get("gem")

    # The same refusal render() makes, made again here. Someone who deep-links this URL
    # must not be able to walk around the floor guard — under-pricing is the thing this
    # whole feature exists to prevent, and a spreadsheet is how it would reach GeM.
    if problem := adapter.check_discount(product):
        raise HTTPException(409, problem)

    data, warnings = adapter.build_workbook(product)
    return Response(
        content=data,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="gem-{product_id}.xlsx"',
            # Surfaced as a header so the app can speak the shortfall without a second
            # request. Missing template, empty required cell — the artisan should hear
            # "this sheet is incomplete" before they upload it to GeM and wait three days.
            #
            # 🐞 ASCII-folded, and that is not tidiness. HTTP header values must be
            # latin-1 encodable; the warning text carries an em dash, so every download of
            # a sheet with any warning attached — which today is every sheet, since no
            # category templates exist — died with a 500 while the workbook itself was
            # built perfectly. The bytes were fine; the header describing them was not.
            "X-Gem-Warnings": ("; ".join(warnings).encode("ascii", "replace").decode()[:500] or "none"),
        },
    )
