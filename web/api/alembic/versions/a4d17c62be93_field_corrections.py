"""field_corrections — what we guessed, and what the artisan changed it to

The labelled half of "the app learns with you". /catalog/defaults remembers what an artisan
said; this remembers what we got wrong, which is worth more because we know the guess, the
truth, and which guesser produced it.

Revision ID: a4d17c62be93
Revises: f2c9b41d7e08
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d17c62be93"
down_revision: str | Sequence[str] | None = "f2c9b41d7e08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "field_corrections",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("artisan_id", sa.String(32), sa.ForeignKey("artisans.id"), nullable=False),
        # Nullable: a correction made on a draft that never became a product is still true
        # and still worth learning from.
        sa.Column("product_id", sa.String(32), sa.ForeignKey("products.id"), nullable=True),
        sa.Column("field", sa.String(40), nullable=False),
        sa.Column("guessed", sa.String(300), nullable=True),
        sa.Column("corrected", sa.String(300), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="default"),
        sa.Column("craft", sa.String(80), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_field_corrections_artisan_id", "field_corrections", ["artisan_id"])
    op.create_index("ix_field_corrections_field", "field_corrections", ["field"])
    # The read is always "this artisan's rows, newest first" (routers/products.py). Without
    # the composite index that is a scan of everything they have ever corrected on the hot
    # path of every new product.
    op.create_index(
        "ix_field_corrections_artisan_recent",
        "field_corrections",
        ["artisan_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_field_corrections_artisan_recent", table_name="field_corrections")
    op.drop_index("ix_field_corrections_field", table_name="field_corrections")
    op.drop_index("ix_field_corrections_artisan_id", table_name="field_corrections")
    op.drop_table("field_corrections")
