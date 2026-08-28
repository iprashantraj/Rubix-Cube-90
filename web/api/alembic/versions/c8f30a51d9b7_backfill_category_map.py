"""Backfill products.category_map and products.hsn_code from the taxonomy

`category_map` had five readers and no writers, so every product in the database carries an
empty one and every adapter resolved `gem_id` / `amazon_node` / `flipkart_vertical` to None.
`routers/products.py` fills it on every PATCH now, but that only helps products somebody
edits afterwards — existing rows would stay blank until touched, which on a demo account
means every catalogued product still publishes with no category.

Only fills what is empty. A `category_map` somebody set deliberately, or an HSN code an
artisan or their accountant chose, outranks our starter table and is left alone.

🚨 HSN is a tax matter. taxonomy.py marks which rows have been checked against the CBIC
schedule and which have not; this migration copies the code either way, because an unfilled
mandatory field blocks six of the seven marketplaces outright. The `verified` flag is what
the UI must surface — not this migration's job, but somebody's.

Revision ID: c8f30a51d9b7
Revises: a4d17c62be93
Create Date: 2026-08-28
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8f30a51d9b7"
down_revision: str | Sequence[str] | None = "a4d17c62be93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHANNEL_KEYS = ("gem_id", "amazon_node", "flipkart_vertical", "ondc_code", "meesho_cat")


def upgrade() -> None:
    # Imported inside the function, not at module scope: a migration that fails to import
    # because an application module moved is a migration that blocks every later one, and
    # this is the only place in the chain that reaches into app code at all.
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    import taxonomy  # noqa: PLC0415

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT p.id, p.category, p.category_map, p.hsn_code, a.craft "
            "FROM products p LEFT JOIN artisans a ON a.id = p.artisan_id"
        )
    ).fetchall()

    filled_map = filled_hsn = 0
    for pid, category, category_map, hsn_code, craft in rows:
        resolved = taxonomy.lookup(category, craft)
        if not resolved:
            continue

        # `category_map` is JSON and reads back as a dict on Postgres and a string on
        # SQLite depending on driver. Treated as "empty or not" rather than parsed, because
        # the only question here is whether somebody already set it.
        existing = category_map
        if isinstance(existing, str):
            try:
                existing = json.loads(existing)
            except ValueError:
                existing = None

        if not existing:
            payload = {k: resolved[k] for k in CHANNEL_KEYS if resolved.get(k)}
            payload["gst_rate"] = resolved.get("gst_rate")
            payload["amazon_ptc"] = resolved.get("amazon_ptc")
            conn.execute(
                sa.text("UPDATE products SET category_map = :m WHERE id = :i"),
                {"m": json.dumps(payload), "i": pid},
            )
            filled_map += 1

        if not hsn_code and resolved.get("hsn"):
            conn.execute(
                sa.text("UPDATE products SET hsn_code = :h WHERE id = :i"),
                {"h": resolved["hsn"], "i": pid},
            )
            filled_hsn += 1

    print(f"[backfill] category_map: {filled_map} rows, hsn_code: {filled_hsn} rows")


def downgrade() -> None:
    # Deliberately not reversible. We cannot tell which values this migration wrote from
    # which an artisan set afterwards, and clearing an HSN somebody chose is worse than
    # leaving ours behind. Dropping the columns is the schema migration's job, not this one.
    pass
