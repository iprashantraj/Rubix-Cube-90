"""Catalog CRUD, and the two AI hops that build a listing.

The catalog is ours (spec §2, rule 1). Products live in our DB whether or not the artisan
ever joins a platform, and editing once regenerates every channel export.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import objectstore
from ..caching import conditional
from ..config import settings
from ..db import get_db
from ..models import Artisan, InventoryLedger, Product, ProductImage, Upload
from ..security import current_artisan

log = logging.getLogger(__name__)

router = APIRouter()


class ProductIn(BaseModel):
    title: str | None = None
    desc_en: str | None = None
    desc_hi: str | None = None
    category: str | None = None
    material: str | None = None
    technique: str | None = None
    dye_type: str | None = None
    time_taken_hours: float | None = None
    dimensions: str | None = None
    weight_grams: int | None = None
    is_fragile: bool = False
    cost_material: float | None = None
    labour_hours: float | None = None
    price: float | None = None
    mrp: float | None = None
    # Stored, not just shown. channels/gem.py refuses to publish when GeM's mandated
    # discount would push the price under this — and that check reads it off the product,
    # so a floor that only ever lived in the /price response left the guard permanently
    # skipped on our headline channel.
    floor_price: float | None = None
    is_made_to_order: bool = False
    lead_time_days: int | None = None
    quantity: int = 1


@router.post("/products")
def create(
    body: ProductIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    product = Product(artisan_id=artisan.id, **body.model_dump(exclude={"quantity"}))
    db.add(product)
    db.flush()
    db.add(InventoryLedger(product_id=product.id, available_qty=body.quantity))
    db.commit()
    return {"id": product.id}


@router.get("/products")
def mine(
    request: Request,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Response:
    """The artisan's catalogue, five columns wide.

    This loaded whole Product entities and then read `p.images` inside the comprehension —
    one extra query per product, so a 40-product catalogue was 41 round trips through the
    pooler to build a list of five fields. The primary image is an outer join now, and the
    columns are named rather than taken wholesale: the descriptions and the channel payloads
    are long text this response never contained and no longer transfers.
    """
    primary = (
        select(ProductImage.product_id, func.min(ProductImage.url).label("url"))
        .where(ProductImage.is_primary.is_(True))
        .group_by(ProductImage.product_id)
        .subquery()
    )
    rows = (
        db.query(
            Product.id,
            Product.title,
            Product.price,
            Product.colour_confirmed,
            primary.c.url,
        )
        .outerjoin(primary, primary.c.product_id == Product.id)
        .filter(Product.artisan_id == artisan.id)
        # created_at DESC then id. Without the tiebreak two products created in the same
        # millisecond can swap places between pages, and one of them is then never shown.
        .order_by(Product.created_at.desc(), Product.id)
        .limit(limit)
        .offset(offset)
        .all()
    )
    payload = [
        {
            "id": r.id,
            "title": r.title,
            "price": float(r.price) if r.price is not None else None,
            "colour_confirmed": r.colour_confirmed,
            "image": r.url,
        }
        for r in rows
    ]
    return conditional(request, payload, max_age=30)


# The fields the cataloguer is allowed to answer from an artisan's own history, and the
# Product column each one reads. Mirrors `carriesForward` in app/src/catalog/slots.js — a
# field in one and not the other is a question asked twice or a default nobody offered.
#
# Deliberately short. A weaver's fibre and turnaround are properties of *them*; a stock
# count and a material cost are properties of the object in front of them, and carrying
# those forward would put last week's numbers under this week's photo.
CARRY_FORWARD = {
    "material": Product.material,
    "lead_time": Product.lead_time_days,
    "weight": Product.weight_grams,
}


@router.get("/catalog/defaults")
def catalog_defaults(
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """What this artisan has already told us, so the cataloguer stops asking for it.

    This is the whole "the app gets quieter the longer you use it" claim, and it is a
    single query — no model, no embedding, no similarity search. See
    docs/Utsav/Product_Questions.md §6.6 for why it is deliberately not a vector store:
    the question "what did this person last say" is a lookup, and dressing it as retrieval
    would add a service, a per-call cost and a non-deterministic answer to a screen that
    has to work on a rural network.

    **Most recent non-null wins, per field independently.** Not the mode: a potter who has
    moved from terracotta to stoneware means it, and the majority of their history is
    exactly the wrong answer. Each field is resolved on its own so one product with a
    weight but no material still contributes its weight.

    Every value is offered to the artisan as a confirmation, never written silently — the
    app turns these into "cotton again?" (`catalog.confirm_same`), which is a tap. A
    default that publishes without being confirmed is a guess under somebody's name.
    """
    # Columns built FROM the map, not listed again alongside it. Writing them out twice is
    # two orderings that have to agree, and the day they stop agreeing every artisan is
    # asked to confirm their material and shown their weight.
    names = list(CARRY_FORWARD)
    rows = (
        db.query(*(CARRY_FORWARD[n] for n in names))
        .filter(Product.artisan_id == artisan.id)
        .order_by(Product.created_at.desc(), Product.id)
        # Enough history to survive a few sparse drafts, small enough to stay one cheap
        # read on the hot path of every new product.
        .limit(20)
        .all()
    )

    out: dict[str, object] = {}
    for row in rows:
        for name, value in zip(names, row, strict=True):
            if name not in out and value is not None:
                out[name] = value
        if len(out) == len(names):
            break
    return out


def _own(product_id: str, db: Session, artisan: Artisan) -> Product:
    p = db.get(Product, product_id)
    if p is None or p.artisan_id != artisan.id:
        raise HTTPException(404, "product not found")
    return p


@router.patch("/products/{product_id}")
def update(
    product_id: str,
    body: ProductIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    p = _own(product_id, db, artisan)
    for k, v in body.model_dump(exclude_unset=True, exclude={"quantity"}).items():
        setattr(p, k, v)
    db.commit()
    return {"ok": True}


class ImageIn(BaseModel):
    url: str
    size_variant: str = "raw"
    is_primary: bool = False


@router.post("/products/{product_id}/images")
def add_image(
    product_id: str,
    body: ImageIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Link a completed upload to a product.

    This is what `enhance()` below looks for: without a `size_variant == "raw"` row there
    is no image to enhance, and the whole AI path stops before it starts.

    🔒 The url is not taken on trust. It has to match an `Upload` row belonging to this
    artisan, because that url is a filesystem URI the AI service will later open — an
    unchecked string here is an arbitrary-file-read with extra steps.
    """
    p = _own(product_id, db, artisan)

    up = db.query(Upload).filter_by(artisan_id=artisan.id, url=body.url).first()
    if up is None:
        raise HTTPException(400, "unknown image url")

    existing = next(
        (i for i in p.images if i.url == body.url and i.size_variant == body.size_variant),
        None,
    )
    if existing is not None:
        # The app retries this call after a dropped response. A second row would give
        # `enhance()` two raw images and a coin flip over which one it sends.
        return {"id": existing.id}

    img = ProductImage(
        product_id=p.id, url=body.url,
        size_variant=body.size_variant, is_primary=body.is_primary,
    )
    db.add(img)
    db.commit()
    return {"id": img.id}


@router.post("/products/{product_id}/confirm-colour")
def confirm_colour(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """The colour lock (spec §5.6).

    After white balance we ask, by voice, "kya yeh asli rang hai?" and publish only on
    confirmation. Practically: return rate destroys artisan income. Legally:
    misrepresentation is a listing violation. Both point the same way.
    """
    p = _own(product_id, db, artisan)
    p.colour_confirmed = True
    db.commit()
    return {"ok": True}


# -- the AI hops -------------------------------------------------------------
# web/ calls ai/ over HTTP and never imports across that line. They are separate deploy
# units; the AI box has a GPU that this one does not.


async def _ai(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient(base_url=settings().ai_base_url, timeout=60) as client:
        res = await client.post(path, json=payload)
        res.raise_for_status()
        return res.json()


async def _ai_get(path: str) -> dict:
    async with httpx.AsyncClient(base_url=settings().ai_base_url, timeout=30) as client:
        res = await client.get(path)
        res.raise_for_status()
        return res.json()


@router.post("/products/{product_id}/enhance")
async def enhance(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    p = _own(product_id, db, artisan)
    raw = next((i.url for i in p.images if i.size_variant == "raw"), None)
    if not raw:
        raise HTTPException(400, "no raw image")

    """
    ⚠️ Send the FULL variant, not the url on the image row.

    What `add_image` stores is `Upload.url`, and `complete()` sets that to the DISPLAY
    variant — 1200px on the long edge — because that string is also what the app renders in
    an <img> and what a marketplace links to. It is the right url for looking at and the
    wrong one for processing: at 4:3 it is 900x1200, and `ai/enhance/pipeline.py` gate()
    refuses anything under `resolution_min_px` (1000) on the SHORT side. Every photograph
    came back `photo.too_small` without the model ever running.

    `full` is never resized (web/api/images.py) and is the variant the pipeline is meant to
    see. It lives in the private bucket, so it is handed over as a short-lived signed URL:
    `ai/` holds no S3 credentials by design, and the artisan's full-resolution photograph
    does not become publicly readable just because we wanted to enhance it.
    """
    source = raw
    if objectstore.available():
        up = db.query(Upload).filter_by(artisan_id=artisan.id, url=raw).first()
        if up is not None:
            try:
                source = objectstore.signed_url(
                    objectstore.key_for(artisan.id, up.id, "full", public=False)
                )
            except objectstore.StorageError as e:
                # Fall back to the display url rather than failing the request. It may still
                # be refused for size, but the artisan hears a real reason either way.
                log.warning("could not sign full variant for %s: %s", up.id, e)

    job = await _ai("/enhance", {
        "product_id": p.id, "image_url": source,
        "targets": ["amazon", "gem", "whatsapp"],
    })
    # Bind the job to this product so the poll below can check ownership. Recorded before
    # the response leaves, or the app is handed a job id nothing on this side recognises.
    if job.get("job_id"):
        p.enhance_job_id = job["job_id"]
        db.commit()
    return job


@router.get("/enhance/{job_id}")
async def enhance_status(
    job_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Poll an enhancement job. The contract path in `ai/contracts.md`, proxied.

    The app polls this every two seconds from `/catalog/prefill` and degrades to the
    artisan's own photo on any failure — so a 404 here is survivable by design, and was in
    fact the entire behaviour until this route existed.

    🔒 The job id alone is not authorisation. It has to belong to one of this artisan's
    products, or one artisan could poll another's job and read back the image urls.
    """
    owner = db.query(Product).filter_by(artisan_id=artisan.id, enhance_job_id=job_id).first()
    if owner is None:
        raise HTTPException(404, "unknown job")
    return await _ai_get(f"/enhance/{job_id}")


@router.post("/products/{product_id}/prefill")
async def prefill(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Vision pre-fill before the artisan says anything (spec §6.4).

    The friction killer: instead of describing a saree from scratch, they only correct
    what we guessed. "Yeh Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?" -> yes.
    """
    p = _own(product_id, db, artisan)
    raw = next((i.url for i in p.images if i.is_primary), None)
    return await _ai("/catalog/prefill", {"image_url": raw})
