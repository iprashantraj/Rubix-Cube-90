"""Object storage. S3 API, Supabase Storage behind it.

One module so there is exactly one place that knows a bucket name, and so swapping Supabase
for R2 or MinIO later is a settings change rather than a grep.

## Why this is not storage.py

`storage.py` stages and assembles the chunks an upload arrives in, on local disk, and is
deliberately stdlib-only so `test_uploads.py` runs with nothing installed. This module needs
boto3 and settings; importing it from there would cost that test its independence. Two
modules, two jobs — bytes are assembled there and published here.

With no S3 configured the publish step is skipped and the local `file://` url stands, which
is what lets `ai/` open an upload on the same machine in dev. That is the arrangement
`docs/Abhay/PIPELINE-RECONCILIATION.md` §5 asked for, and it is why this file no longer
answers 503 on the upload path.

## Two buckets, and the split is a privacy boundary, not tidiness

    kaarigar-raw   PRIVATE. What the artisan's camera produced, plus the archival full-size.
    kaarigar       PUBLIC.  The derived variants that a marketplace page links to.

It has to be two buckets. Supabase (and S3) attach public-read to the bucket, so every
object in a public one is fetchable by anyone holding the URL — a `raw/` key prefix inside
a public bucket is a naming convention, not a boundary, and an earlier version of this file
claimed otherwise. `raw/` holds a photograph taken inside somebody's home; it is read only
by our own pipeline, over a credentialed request.

Keys keep the `raw/` and `public/` prefixes anyway, so a key names its own bucket and a
misfiled object is visible at a glance rather than only in an access log.

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
        # None, not "", when unset: boto3 signs an empty session token as a real one and the
        # request comes back 403 with nothing pointing at the cause.
        aws_session_token=s.s3_session_token or None,
        # Supabase Storage requires a region even though it ignores the value, and it only
        # speaks the v4 signature. Path-style addressing because the endpoint is a single
        # host, not a per-bucket subdomain.
        region_name=getattr(s, "s3_region", None) or "us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def key_for(artisan_id: str, upload_id: str, variant: str, public: bool) -> str:
    prefix = PUBLIC_PREFIX if public else RAW_PREFIX
    return f"{prefix}/{artisan_id}/{upload_id}/{variant}.jpg"


def bucket_for(key: str) -> str:
    """Which bucket a key belongs in. Derived from the key so no caller can get it wrong."""
    s = settings()
    return s.s3_raw_bucket if key.startswith(f"{RAW_PREFIX}/") else s.s3_bucket


def put(key: str, data: bytes, content_type: str = "image/jpeg") -> str:
    """Store bytes, return the URL to read them back.

    Raises StorageError rather than a boto exception so callers do not have to know which
    library is underneath — the whole point of this module.
    """
    try:
        _client().put_object(
            Bucket=bucket_for(key),
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
    """The URL for a key. Anonymously fetchable only for keys in the public bucket.

    A raw key gets the credentialed object path instead — a stable identifier our own
    pipeline can read with the service key, which returns 400 to anyone else. Deliberately
    not a signed URL: signed URLs expire, and this string is stored in the database.
    """
    base = settings().s3_endpoint.rstrip("/")
    is_public = not key.startswith(f"{RAW_PREFIX}/")
    # Supabase's S3 endpoint and its REST object endpoints are different paths on the same
    # host. Derive rather than adding settings nobody would keep in step.
    if "/storage/v1/s3" in base:
        rest = "/storage/v1/object/public" if is_public else "/storage/v1/object"
        base = base.replace("/storage/v1/s3", rest)
    return f"{base}/{bucket_for(key)}/{key}"


def signed_url(key: str, ttl_seconds: int = 900) -> str:
    """A time-limited URL for a PRIVATE object.

    The enhancement pipeline needs the `full` variant, which lives in the private bucket and
    therefore cannot be fetched by an anonymous GET — and `ai/` holds no S3 credentials by
    design, because it is a separate deploy unit that should not need them.

    So the caller signs one URL, valid for a few minutes, and hands over that. The AI
    service opens it exactly like any other https source (`ai/enhance/storage.py`), the
    original never becomes publicly readable, and no key ever crosses the service boundary.

    ⚠️ NOT for anything stored in the database. This string expires; `url_for()` is the
    stable identifier and is what a Product row keeps.
    """
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket_for(key), "Key": key},
        ExpiresIn=ttl_seconds,
    )


def available() -> bool:
    """Whether storage is configured at all. Dev boxes frequently have no S3."""
    s = settings()
    return bool(s.s3_access_key and s.s3_secret_key)
