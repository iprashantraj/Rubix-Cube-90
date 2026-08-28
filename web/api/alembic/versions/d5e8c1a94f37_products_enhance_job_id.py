"""products.enhance_job_id

models.py declared this column and no migration ever created it, so `alembic upgrade head`
produced a schema the ORM could not INSERT into:

    UndefinedColumn: column "enhance_job_id" of relation "products" does not exist

Every POST /api/products failed with a 500 on a fresh database. It was invisible to anyone
whose database predates the column being added to the model, because their table was built
by an older `create_all()` — which is exactly the drift `web/README.md` warns about when it
says anything past the dev bootstrap goes through Alembic.

Indexed to match the model. The index is the point of the column: GET /api/enhance/{job_id}
looks a product up BY job id to prove the caller owns the job before proxying, and without
it that authorisation check is a sequential scan of every product in the table.

Additive and nullable, so it applies to a live table without a rewrite.

Revision ID: d5e8c1a94f37
Revises: c3a71f0d5e42
Create Date: 2026-08-28 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e8c1a94f37'
down_revision: Union[str, Sequence[str], None] = 'c3a71f0d5e42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('enhance_job_id', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_products_enhance_job_id'), 'products', ['enhance_job_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_products_enhance_job_id'), table_name='products')
    op.drop_column('products', 'enhance_job_id')
