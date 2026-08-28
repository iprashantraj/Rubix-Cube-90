"""Artisan profile, readiness flags, and the GST route decision."""

from __future__ import annotations

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..channels import registry
from ..db import get_db
from ..models import Artisan, Cluster
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
    # Channel ids the artisan says they already sell on. Validated against the adapter
    # registry in update_me rather than typed as an enum here, so adding a channel is
    # still one file (channels/registry.py) and never two.
    sells_on: list[str] | None = None


@router.get("/me")
def me(artisan: Artisan = Depends(current_artisan)) -> dict:
    return {
        "id": artisan.id,
        "display_name": artisan.display_name,
        "craft": artisan.craft,
        "language": artisan.language,
        "pincode": artisan.pincode,
        # Read by the app and sent back on POST /price, where it selects the cluster wage
        # rate. Omitting it here is what kept every artisan on the default rate even after
        # the pincode link existed.
        "cluster_id": artisan.cluster_id,
        "readiness": {
            "has_pan": artisan.has_pan,
            "has_bank": artisan.has_bank,
            "has_gst": artisan.has_gst,
            "has_artisan_card": artisan.has_artisan_card,
            "intra_state_only": artisan.intra_state_only,
        },
        # `or []` because every artisan created before the column existed reads back NULL,
        # and a caller that has to distinguish NULL from [] to render a list will
        # eventually forget to. They mean the same thing: we have nothing on file.
        "sells_on": artisan.sells_on or [],
    }


def cluster_for_pincode(pincode: str | None, db: Session) -> Cluster | None:
    """Longest matching pincode prefix, or None.

    Longest-first so a narrow cluster beats a broad one when both match — adding a more
    specific prefix later takes precedence with no code change, the same rule the pricing
    taxonomy walk-up follows.

    None is a supported answer and the common one: most of India is not in a cluster we have
    onboarded. It leaves `cluster_id` NULL and pricing falls back to `default_wage_per_hour`,
    which is exactly today's behaviour — so this can only ever add a correct wage rate, never
    substitute a wrong one for a right one.
    """
    if not pincode:
        return None
    return (
        db.query(Cluster)
        .filter(Cluster.pincode_prefix.isnot(None))
        .filter(sa.literal(pincode).like(Cluster.pincode_prefix + "%"))
        .order_by(sa.func.length(Cluster.pincode_prefix).desc())
        .first()
    )


@router.patch("/me")
def update_me(
    body: ProfileIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    fields = body.model_dump(exclude_unset=True)

    # Only ids the registry actually knows. A channel list is written straight into a JSON
    # column and read back later to decide which questions to ask and which rows to draw,
    # so an unknown string here becomes a channel that can never be published to and a
    # question nobody can answer. Dropped rather than refused: a newer app offering a
    # channel this server has not learned yet should still save the ones it does know.
    if "sells_on" in fields:
        known = set(registry.ADAPTERS)
        fields["sells_on"] = sorted({c for c in (fields["sells_on"] or []) if c in known})

    for k, v in fields.items():
        setattr(artisan, k, v)

    # The cluster auto-link OnboardPlace.jsx has always said it was collecting a pincode for.
    # It decides the wage rate in the price floor, so it is worth more than serviceability:
    # without it every artisan in the country prices their labour at one default rate.
    if "pincode" in fields:
        cluster = cluster_for_pincode(artisan.pincode, db)
        artisan.cluster_id = cluster.id if cluster else None

    db.commit()
    return {"ok": True, "cluster_id": artisan.cluster_id}


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
