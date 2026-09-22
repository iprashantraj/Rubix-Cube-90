#!/usr/bin/env python3
"""Rewrite stored `http://<host>:8000/api/enhanced/...` image urls to `/api/enhanced/...`.

## Why this exists

`_publish_local` used to build absolute urls from whichever host the caller happened to
use. `_record_variants` writes those to the database, so every enhanced product row carried
one laptop's DHCP lease. When the lease moved (10.169.219.181 -> 172.29.32.131) every
previously enhanced product pointed at an address that no longer answered:

  * thumbnails on /home and /products went blank
  * /catalog/prefill asked "is this the real colour?" over an empty frame, which is the one
    question CONTRIBUTING.md rule 4 says must never be asked about an image nobody can see

Rebuilding the app could not fix it, because the dead host was in the database, not in the
bundle. `_publish_local` now stores root-relative urls and the app resolves them through
`apiUrl()`, so new rows cannot go stale. This repairs the rows written before that change.

## What it touches

Only `product_images.url` values matching `^https?://<host>/api/enhanced/`. S3 urls, blob
urls, `file://` urls and anything already relative are left alone — the pattern requires the
`/api/enhanced/` path, which only this local-serving mode produces.

Idempotent: running it twice changes nothing the second time.

⚠️ Run it with the API's interpreter, not the system one — `sqlalchemy` and the settings
this imports live in that virtualenv, and plain `python3` fails at the import.

    web/api/.venv/bin/python scripts/relativise_enhanced_urls.py --dry-run   # count first
    web/api/.venv/bin/python scripts/relativise_enhanced_urls.py

Leave the servers running. This is one UPDATE; Postgres handles it concurrently and the API
only reads these rows. Force-close the app afterwards, though — TanStack Query caches the
product list and will keep painting the old urls until it refetches.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "web"))

from api.config import settings  # noqa: E402

# Anchored, and it requires the /api/enhanced/ path: an S3 url or a marketplace CDN url has
# no business being rewritten, and this is the only shape _publish_local ever produced.
ABSOLUTE_LOCAL = r"^https?://[^/]+/api/enhanced/"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="count, change nothing")
    args = ap.parse_args()

    engine = sa.create_engine(settings().database_url)
    with engine.begin() as conn:
        stale = conn.execute(
            sa.text("select count(*) from product_images where url ~ :p"),
            {"p": ABSOLUTE_LOCAL},
        ).scalar_one()
        print(f"rows with an absolute /api/enhanced url: {stale}")

        if stale and not args.dry_run:
            conn.execute(
                sa.text(
                    "update product_images "
                    "set url = regexp_replace(url, '^https?://[^/]+', '') "
                    "where url ~ :p"
                ),
                {"p": ABSOLUTE_LOCAL},
            )
            print("rewritten to root-relative")
        elif stale:
            print("(dry run — nothing written)")

        remaining = conn.execute(
            sa.text("select count(*) from product_images where url ~ :p"),
            {"p": ABSOLUTE_LOCAL},
        ).scalar_one()
        relative = conn.execute(
            sa.text("select count(*) from product_images where url like '/api/enhanced/%'")
        ).scalar_one()
        print(f"remaining absolute: {remaining}")
        print(f"now relative      : {relative}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
