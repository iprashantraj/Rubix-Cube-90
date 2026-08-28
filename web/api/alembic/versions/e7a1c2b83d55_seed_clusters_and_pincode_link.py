"""seed clusters, and link an artisan to one by pincode

`ai/price/rates.json` has carried per-cluster wage rates since the pricing feature was
written -- Sambalpur 120, Bhuj 140, Varanasi 150, Channapatna 110 -- and NONE of them could
ever be used. Nothing set `artisans.cluster_id`, the clusters table was empty, and
`Cluster.wage_rate_per_hour` was read by no code at all. So every artisan fell through to
`default_wage_per_hour`, and the labour half of every price floor was one hardcoded 120 for
the whole country. A Varanasi weaver's floor was quietly 20% short.

`OnboardPlace.jsx` already collects a pincode and its own header already says the pincode is
for "serviceability, cluster auto-link, and the intra-state check". The auto-link was
designed and never built. This is it.

`pincode_prefix` is the join. Matching is longest-prefix and exact-string, so an unmatched
pincode leaves `cluster_id` NULL and pricing falls back to the default exactly as it does
today -- this can only ever add a correct rate, never substitute a wrong one.

⚠️ THE PREFIXES NEED FIELD CONFIRMATION. They are the postal ranges for the districts these
clusters sit in, which is not the same thing as a cluster's actual catchment: a weaver
20km outside Sambalpur town shares the 768 prefix and may belong to no cluster at all, and
a cluster may draw from two prefixes. Wage rates come straight from rates.json and are
themselves marked "sourced per cluster, not guessed" -- confirm both with the cluster
coordinators before this decides anybody's floor in the field.

Revision ID: e7a1c2b83d55
Revises: d5e8c1a94f37
Create Date: 2026-08-28 12:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7a1c2b83d55'
down_revision: Union[str, Sequence[str], None] = 'd5e8c1a94f37'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (id, name, district, state, wage_rate_per_hour, pincode_prefix)
# Wage rates are copied from ai/price/rates.json, not invented here. The ids match its keys
# so the two cannot drift into disagreeing about who "sambalpur" is.
CLUSTERS = [
    ('sambalpur',   'Sambalpur',   'Sambalpur',  'Odisha',      120, '768'),
    ('bhuj',        'Bhuj',        'Kachchh',    'Gujarat',     140, '370'),
    ('varanasi',    'Varanasi',    'Varanasi',   'Uttar Pradesh', 150, '221'),
    ('channapatna', 'Channapatna', 'Ramanagara', 'Karnataka',   110, '5621'),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('clusters', sa.Column('pincode_prefix', sa.String(length=6), nullable=True))
    op.create_index(op.f('ix_clusters_pincode_prefix'), 'clusters', ['pincode_prefix'])

    clusters = sa.table(
        'clusters',
        sa.column('id', sa.String), sa.column('name', sa.String),
        sa.column('district', sa.String), sa.column('state', sa.String),
        sa.column('wage_rate_per_hour', sa.Numeric),
        sa.column('pincode_prefix', sa.String),
    )
    op.bulk_insert(clusters, [
        dict(id=i, name=n, district=d, state=s, wage_rate_per_hour=w, pincode_prefix=p)
        for i, n, d, s, w, p in CLUSTERS
    ])


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM clusters WHERE id IN %s" % str(tuple(c[0] for c in CLUSTERS)))
    op.drop_index(op.f('ix_clusters_pincode_prefix'), table_name='clusters')
    op.drop_column('clusters', 'pincode_prefix')
