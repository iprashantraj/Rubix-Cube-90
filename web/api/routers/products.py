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
from ..models import Artisan, InventoryLedger, Product
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
    return await _ai("/enhance", {
        "product_id": p.id, "image_url": raw,
        "targets": ["amazon", "gem", "whatsapp"],
    })


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
