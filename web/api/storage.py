"""Object storage. S3 API, Supabase Storage behind it.

One module so there is exactly one place that knows a bucket name, and so swapping Supabase
for R2 or MinIO later is a settings change rather than a grep.

## Two buckets, and the split is a privacy boundary, not tidiness

    raw/        what the artisan's camera produced. Never served publicly.
    public/     the derived variants that a marketplace page links to.

Anything in `public/` can be fetched by anyone who guesses the URL, so nothing lands there
that was not deliberately derived for it. `raw/` holds the original frame — which is a
photograph taken inside somebody's home — and is only ever read by our own pipeline.

## Keys are unguessable on purpose

`{prefix}/{artisan_id}/{upload_id}/{variant}.jpg` where `upload_id` is a 32-hex id. Product
images are effectively public URLs even when the listing is not live yet, so the id has to
carry the access control. Never key by anything sequential or by phone number.
"""

from __future__ import annotations

import logging
from functools import lru_cache

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from .config import settings

log = logging.getLogger(__name__)

RAW_PREFIX = "raw"
PUBLIC_PREFIX = "public"


class StorageError(RuntimeError):
    """Object storage is unreachable or misconfigured."""


@lru_cache
def _client():
    s = settings()
    if not (s.s3_access_key and s.s3_secret_key):
        raise StorageError("S3_ACCESS_KEY / S3_SECRET_KEY are not set")
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        # Supabase Storage requires a region even though it ignores the value, and it only
        # speaks the v4 signature. Path-style addressing because the endpoint is a single
        # host, not a per-bucket subdomain.
        region_name=getattr(s, "s3_region", None) or "us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def key_for(artisan_id: str, upload_id: str, variant: str, public: bool) -> str:
    prefix = PUBLIC_PREFIX if public else RAW_PREFIX
    return f"{prefix}/{artisan_id}/{upload_id}/{variant}.jpg"


def put(key: str, data: bytes, content_type: str = "image/jpeg") -> str:
    """Store bytes, return the URL to read them back.

    Raises StorageError rather than a boto exception so callers do not have to know which
    library is underneath — the whole point of this module.
    """
    s = settings()
    try:
        _client().put_object(
            Bucket=s.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            # A year. These are immutable: a new photo gets a new upload id and therefore a
            # new key, so a cached copy can never be stale. That matters more than usual
            # here — the marketplace serves product photos to shoppers, and re-fetching an
            # unchanged image is bandwidth somebody pays for.
            CacheControl="public, max-age=31536000, immutable",
        )
    except (BotoCoreError, ClientError) as e:
        log.warning("storage put failed for %s: %s", key, e)
        raise StorageError(str(e)) from e
    return url_for(key)


def url_for(key: str) -> str:
    """The public URL for a key.

    Supabase serves `public/` objects at a documented path; anything else needs a signed
    URL, which is why raw originals are not linkable by accident.
    """
    s = settings()
    base = s.s3_endpoint.rstrip("/")
    # Supabase's S3 endpoint and its public-read endpoint are different paths on the same
    # host. Derive rather than adding a second setting nobody would keep in step.
    if "/storage/v1/s3" in base:
        base = base.replace("/storage/v1/s3", "/storage/v1/object/public")
        return f"{base}/{s.s3_bucket}/{key}"
    return f"{base}/{s.s3_bucket}/{key}"


def available() -> bool:
    """Whether storage is configured at all. Dev boxes frequently have no S3."""
    s = settings()
    return bool(s.s3_access_key and s.s3_secret_key)
