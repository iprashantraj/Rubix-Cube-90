"""products.retry_of — the retake chain

`ai/enhance/observe.py` writes one row per upload so the gate's thresholds can be re-tuned
on real traffic instead of on the 93 scenes they were calibrated against. Those rows record
what the gate decided and never whether the artisan agreed, and that is the half that
matters: a refusal followed by a retake that passes is a correct refusal, a refusal followed
by three more and then silence is a false one that cost a seller. Both look the same in the
AI's log. This column is the difference, and `product_id` on every observation row is the
join. Requested in `docs/Abhay/CHANGELOG.md`, 2026-09-07 (2).

Self-referential, nullable and indexed. Indexed because the query this exists to serve reads
in the retake direction — "what did this refused product become" — which is a lookup BY
retry_of, not by id.

Additive and nullable, so it applies to a live table without a rewrite.

Revision ID: a1b6d3e40f92
Revises: c8f30a51d9b7
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b6d3e40f92'
down_revision: Union[str, Sequence[str], None] = 'c8f30a51d9b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('retry_of', sa.String(length=32), nullable=True))
    op.create_index(op.f('ix_products_retry_of'), 'products', ['retry_of'])
    op.create_foreign_key('fk_products_retry_of_products', 'products', 'products',
                          ['retry_of'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_products_retry_of_products', 'products', type_='foreignkey')
    op.drop_index(op.f('ix_products_retry_of'), table_name='products')
    op.drop_column('products', 'retry_of')
