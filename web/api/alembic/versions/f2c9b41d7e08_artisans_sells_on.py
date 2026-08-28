"""artisans.sells_on — which marketplaces the artisan already sells on

Asked once in onboarding and used to decide which questions the cataloguer bothers asking:
`plan()` in app/src/catalog/slots.js only asks for a slot some target channel needs, so an
artisan with no Amazon or Flipkart account is never asked for a shipping weight.

Nullable with a server default of an empty JSON array rather than NOT NULL. Every existing
artisan predates the question, and "we have not asked them yet" is the honest state — it is
also indistinguishable from "they said none", which is fine: both mean the cataloguer falls
back to tier A, which is the fewest questions and the correct default.

Revision ID: f2c9b41d7e08
Revises: e7a1c2b83d55
Create Date: 2026-08-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f2c9b41d7e08"
down_revision: str | Sequence[str] | None = "e7a1c2b83d55"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default so rows written by anything that predates this column still read back
    # as a list rather than NULL — the API treats NULL and [] the same, but a JSON column
    # that is sometimes NULL and sometimes [] is a bug waiting for whoever writes the next
    # query against it.
    op.add_column(
        "artisans",
        sa.Column("sells_on", sa.JSON(), nullable=True, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("artisans", "sells_on")
