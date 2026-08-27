"""Phone + OTP. This IS the account — no password, no email, and the only typing in the
entire artisan app."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Artisan, Consent
from ..security import check_otp, hash_otp, issue_token, make_otp

router = APIRouter()

# ponytail: in-memory OTP store. Move to Redis with the same TTL when the API runs on more
# than one process — a second worker would reject every code the first one issued.
PENDING: dict[str, tuple[str, float]] = {}


class StartRequest(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def indian_mobile(cls, v: str) -> str:
        v = v.strip().removeprefix("+91")
        # Dev takes any digits: demo numbers do not all start 6-9, and a test account is
        # easier to remember as 1111111111. Still digits-only even here — `phone` is the
        # account identity, and letting two spellings of one number through would quietly
        # create two artisans. Production keeps the real rule.
        if settings().is_dev:
            if not v.isdigit():
                raise ValueError("phone must be digits")
            return v
        if not (v.isdigit() and len(v) == 10 and v[0] in "6789"):
            raise ValueError("not a valid Indian mobile number")
        return v


class VerifyRequest(StartRequest):
    otp: str
    language: str = "hi"
    notice_version: str = "1"


@router.post("/auth/start")
def start(req: StartRequest) -> dict:
    otp = make_otp()
    PENDING[req.phone] = (hash_otp(req.phone, otp), time.time() + settings().otp_ttl_seconds)
    # TODO(phase 1): hand to an SMS gateway. Never log the code outside dev.
    return {"sent": True, **({"dev_otp": otp} if settings().is_dev else {})}


@router.post("/auth/verify")
def verify(req: VerifyRequest, db: Session = Depends(get_db)) -> dict:
    # 🔒 Dev only, and it must stay that way: any code logs you in, and a number that was
    # never sent one still logs you in. This exists because there is no SMS gateway yet and
    # the in-memory PENDING map is emptied by every server restart — mid-demo, that logged
    # the tester out of an app they were standing in front of a room demonstrating.
    #
    # `is_dev` is ENVIRONMENT=dev in the environment, so a deployment that forgets to set it
    # fails closed into the real check rather than open into this one.
    if settings().is_dev:
        PENDING.pop(req.phone, None)
    else:
        entry = PENDING.get(req.phone)
        if not entry or entry[1] < time.time():
            raise HTTPException(400, "otp expired")
        if not check_otp(req.phone, req.otp, entry[0]):
            raise HTTPException(400, "otp incorrect")
        # Single use. Without this a leaked code stays valid for its whole TTL.
        PENDING.pop(req.phone, None)

    artisan = db.query(Artisan).filter_by(phone=req.phone).one_or_none()
    created = artisan is None
    if created:
        artisan = Artisan(phone=req.phone, language=req.language)
        db.add(artisan)
        db.flush()
        # The DPDP consent artifact: what was agreed, in which language, against which
        # version of the notice. The notice itself is played by voice (spec §14.6).
        db.add(
            Consent(
                artisan_id=artisan.id,
                language=req.language,
                notice_version=req.notice_version,
            )
        )
    db.commit()

    return {
        "token": issue_token(artisan.id),
        "created": created,
        "artisan": {
            "id": artisan.id,
            "display_name": artisan.display_name,
            "language": artisan.language,
        },
    }
