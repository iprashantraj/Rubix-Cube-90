"""Auth and secret handling.

Two rules from spec §14 that this module exists to enforce:

  1. We never ask for a platform credential. OAuth redirect only. If any demo shows
     "enter your Amazon password", that is a disqualification-level flaw.
  2. We verify, we do not store. Readiness is a boolean; the PAN number itself has no
     home anywhere in this system.

The one exception is Amazon/Flipkart OAuth refresh tokens, held only when the artisan
explicitly connects, and encrypted at rest here.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.fernet import Fernet
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Artisan

ALGO = "HS256"


def _secret() -> str:
    s = settings().jwt_secret
    if not s:
        if not settings().is_dev:
            raise RuntimeError("JWT_SECRET must be set outside dev")
        return "dev-only-not-a-secret"
    return s


def issue_token(artisan_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings().jwt_ttl_hours)
    return jwt.encode({"sub": artisan_id, "exp": exp}, _secret(), algorithm=ALGO)


def current_artisan(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Artisan:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        payload = jwt.decode(token, _secret(), algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad token") from None

    artisan = db.get(Artisan, payload["sub"])
    if artisan is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown artisan")
    return artisan


# -- OTP ---------------------------------------------------------------------


def make_otp() -> str:
    """Six digits from a CSPRNG. `random` is not acceptable for anything that gates
    access to an account."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(phone: str, otp: str) -> str:
    """Store the hash, never the code. Salted with the phone so the same OTP for two
    numbers does not collide."""
    return hmac.new(_secret().encode(), f"{phone}:{otp}".encode(), hashlib.sha256).hexdigest()


def check_otp(phone: str, otp: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(phone, otp), expected_hash)


# -- channel token storage ---------------------------------------------------


def _fernet() -> Fernet:
    key = settings().token_encryption_key
    if not key:
        raise RuntimeError("TOKEN_ENCRYPTION_KEY must be set to store channel tokens")
    return Fernet(key.encode())


def encrypt_token(raw: str) -> str:
    return _fernet().encrypt(raw.encode()).decode()


def decrypt_token(enc: str) -> str:
    return _fernet().decrypt(enc.encode()).decode()
