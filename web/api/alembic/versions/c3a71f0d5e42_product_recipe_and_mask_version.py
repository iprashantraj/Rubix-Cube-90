"""product recipe and mask_version

Requested by docs/Abhay/PIPELINE-RECONCILIATION.md §4, which needs somewhere to store the
enhancement as PARAMETERS rather than as a modified image. With a recipe on the row,
`render(original, mask, recipe)` becomes the only thing that produces pixels — so rule 2 in
CLAUDE.md ("never destroy the original") holds by construction instead of by discipline, and
switching tier stops meaning "re-run segmentation".

`recipe` is JSON and deliberately schemaless on this side: its shape belongs to ai/, and this
table should not need a migration every time a stage gains a parameter. `mask_version` is the
model that produced the mask the recipe was built against, which is what will say who needs
re-rendering when a better mask ships.

Both are additive and nullable-or-defaulted, so this applies to a live table without a
rewrite and without blocking writes. server_default='{}' on recipe, not just a Python-side
default: rows written by anything that is not this ORM still get a valid object rather than
a NULL that every reader has to guard.

Revision ID: c3a71f0d5e42
Revises: b9164af8a274
Create Date: 2026-08-27 22:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3a71f0d5e42'
down_revision: Union[str, Sequence[str], None] = 'b9164af8a274'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'products',
        sa.Column('recipe', sa.JSON(), nullable=False, server_default='{}'),
    )
    op.add_column('products', sa.Column('mask_version', sa.String(length=40), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('products', 'mask_version')
    op.drop_column('products', 'recipe')
