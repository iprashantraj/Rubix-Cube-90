"""Public marketplace + bulk RFQ. Spec §3.3.

Unauthenticated on purpose: these are the pages that have to be indexable, and they are
the only *direct* B2B surface we have. On Amazon we are one of a million sellers, which is
indirect by definition; a buyer browsing this catalog and sending a bulk RFQ IS the direct
connection the PS asks for.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Listing, Product

router = APIRouter()


@router.get("/shop/products")
def browse(
    craft: str | None = None,
    cluster: str | None = None,
    gi: str | None = None,
    limit: int = 40,
    db: Session = Depends(get_db),
) -> list[dict]:
    q = (
        db.query(Product)
        .join(Listing, Listing.product_id == Product.id)
        .filter(Listing.channel == "marketplace", Listing.status == "live")
    )
    if craft:
        q = q.filter(Product.category.ilike(f"%{craft}%"))
    if gi:
        q = q.filter(Product.gi_claim.isnot(None))
    if cluster:
        q = q.join(Product.artisan).filter_by(cluster_id=cluster)

    return [
        {
            "id": p.id,
            "title": p.title,
            "desc_en": p.desc_en,
            "price": float(p.price) if p.price else None,
            "gi_claim": p.gi_claim,
            "certifications": p.certifications,
            "images": [i.url for i in p.images],
        }
        for p in q.limit(min(limit, 100)).all()
    ]


class RFQ(BaseModel):
    """Bulk quote request. A shopkeeper needing 200 gamchas has no way to say that on
    Amazon — this is the only channel where the requirement can even be expressed."""

    product_id: str
    quantity: int
    buyer_name: str
    buyer_email: EmailStr
    message: str | None = None

    @field_validator("quantity")
    @classmethod
    def bulk_only(cls, v: int) -> int:
        if v < 2:
            raise ValueError("an RFQ is for bulk; use the normal cart for single items")
        return v


@router.post("/shop/rfq")
def request_quote(rfq: RFQ, db: Session = Depends(get_db)) -> dict:
    product = db.get(Product, rfq.product_id)
    if product is None:
        return {"ok": False}
    # TODO(phase 5): notify the artisan by VOICE in their language, with the cluster
    # coordinator copied — a text-only RFQ notification is unreadable to the person it
    # is for.
    return {"ok": True, "artisan_id": product.artisan_id}
