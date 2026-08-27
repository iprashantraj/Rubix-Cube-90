"""Channel list, OAuth connect, and the guided-listing selector packs."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..channels import registry
from ..db import get_db
from ..models import Artisan, ChannelStatus
from ..security import current_artisan

router = APIRouter()
PACKS = Path(__file__).resolve().parents[1] / "selectorpacks"


@router.get("/channels")
def list_channels(
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> list[dict]:
    statuses = {
        s.channel.value: s
        for s in db.query(ChannelStatus).filter_by(artisan_id=artisan.id).all()
    }
    out = []
    for adapter in registry.ADAPTERS.values():
        st = statuses.get(adapter.id)
        out.append(
            {
                **adapter.describe(),
                "connected": bool(st and st.refresh_token_enc),
                "signup_status": st.signup_status.value if st else "not_started",
            }
        )
    return out


@router.get("/channels/{channel_id}/selectorpack")
def selector_pack(channel_id: str) -> dict:
    """Autofill selector pack for the guided browser. Architecture §6.4.

    Served at runtime and never compiled into the app, so a DOM change on the far side is
    a config push we ship in an hour rather than an app update that rural users will never
    install. A missing or disabled pack is not an error — the app falls back to spoken
    guided-paste, which is the behaviour we ship by default anyway.
    """
    path = PACKS / f"{channel_id}.json"
    if not path.exists():
        return {"channel": channel_id, "enabled": False, "steps": []}
    return json.loads(path.read_text(encoding="utf-8"))
