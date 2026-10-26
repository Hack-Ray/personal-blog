"""Site traffic from Cloudflare and search data from Google Search Console.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "traffic_days",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("requests", sa.BigInteger, nullable=False),
        sa.Column("cached_requests", sa.BigInteger, nullable=False),
        sa.Column("bytes", sa.BigInteger, nullable=False),
        sa.Column("cached_bytes", sa.BigInteger, nullable=False),
        sa.Column("page_views", sa.BigInteger, nullable=False),
        sa.Column("visitors", sa.BigInteger, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Totals are kept apart from the per-query rows: Search Console leaves
    # anonymized queries out of those, so they do not add up to the totals.
    op.create_table(
        "search_days",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("dimension", sa.Text, primary_key=True),
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("clicks", sa.Integer, nullable=False),
        sa.Column("impressions", sa.Integer, nullable=False),
        sa.Column("position", sa.Double, nullable=False),
        sa.CheckConstraint("dimension IN ('total', 'query', 'page')", name="search_days_dimension"),
        sa.CheckConstraint("(dimension = 'total') = (key = '')", name="search_days_total_key"),
    )
    op.create_table(
        "analytics_sources",
        sa.Column("source", sa.Text, primary_key=True),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error", sa.Text),
        sa.CheckConstraint("source IN ('cloudflare', 'search_console')", name="analytics_sources_source"),
    )


def downgrade() -> None:
    op.drop_table("analytics_sources")
    op.drop_table("search_days")
    op.drop_table("traffic_days")
