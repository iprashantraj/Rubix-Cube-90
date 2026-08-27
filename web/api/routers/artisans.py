"""Artisan profile, readiness flags, and the GST route decision."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Artisan
from ..security import current_artisan

router = APIRouter()


class ProfileIn(BaseModel):
    display_name: str | None = None
    craft: str | None = None
    pincode: str | None = None
    language: str | None = None
    upi_id: str | None = None
    # 🔒 Booleans only. If you are about to add `pan_number` here, read spec §14.2.
    has_pan: bool | None = None
    has_bank: bool | None = None
    has_gst: bool | None = None
    has_artisan_card: bool | None = None
    intra_state_only: bool | None = None


@router.get("/me")
def me(artisan: Artisan = Depends(current_artisan)) -> dict:
    return {
        "id": artisan.id,
        "display_name": artisan.display_name,
        "craft": artisan.craft,
        "language": artisan.language,
        "pincode": artisan.pincode,
        "readiness": {
            "has_pan": artisan.has_pan,
            "has_bank": artisan.has_bank,
            "has_gst": artisan.has_gst,
            "has_artisan_card": artisan.has_artisan_card,
            "intra_state_only": artisan.intra_state_only,
        },
    }


@router.patch("/me")
def update_me(
    body: ProfileIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(artisan, k, v)
    db.commit()
    return {"ok": True}


@router.get("/me/gst-route")
def gst_route(artisan: Artisan = Depends(current_artisan)) -> dict:
    """🔑 Most artisans do not need GST registration at all.

    Notification 34/2023-Central Tax (effective 1 Oct 2023) exempts persons supplying goods
    through an e-commerce operator from mandatory GST registration where supplies are
    intra-state only, they hold a PAN, and they obtain an enrolment number on the common
    portal.

    Almost no other team will know this notification exists, and it is the single most
    direct answer to "drastically lower the barrier to entry" in the whole problem
    statement — it removes a legal wall rather than making one easier to climb.

    ⚠️ Guidance, not advice. The turnover threshold is state-specific and the enrolment
    number must be obtained before supplying through an ECO.
    """
    if artisan.has_gst:
        return {"route": "already_registered", "voice_key": "gst.already"}
    if not artisan.has_pan:
        return {"route": "needs_pan_first", "voice_key": "gst.needs_pan"}
    if not artisan.intra_state_only:
        return {"route": "full_registration", "voice_key": "gst.full_required"}
    return {"route": "enrolment_only", "voice_key": "gst.enrolment_only"}


@router.delete("/me")
def erase(
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """DPDP erasure — "mera data mitaayein" in /settings.

    Cheap for us precisely because of the boolean design: there are no documents to
    shred, no PAN to expunge, no bank number to find in a backup. What we don't store
    cannot leak, and it also cannot be left behind.
    """
    db.delete(artisan)
    db.commit()
    return {"erased": True}
