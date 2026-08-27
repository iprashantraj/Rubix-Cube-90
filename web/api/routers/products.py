"""Catalog CRUD, and the two AI hops that build a listing.

The catalog is ours (spec §2, rule 1). Products live in our DB whether or not the artisan
ever joins a platform, and editing once regenerates every channel export.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Artisan, InventoryLedger, Product, ProductImage, Upload
from ..security import current_artisan

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
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> list[dict]:
    rows = db.query(Product).filter_by(artisan_id=artisan.id).order_by(Product.created_at.desc())
    return [
        {
            "id": p.id,
            "title": p.title,
            "price": float(p.price) if p.price else None,
            "colour_confirmed": p.colour_confirmed,
            "image": next((i.url for i in p.images if i.is_primary), None),
        }
        for p in rows
    ]


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
    job = await _ai("/enhance", {
        "product_id": p.id, "image_url": raw,
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
