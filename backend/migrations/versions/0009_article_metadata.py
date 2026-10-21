"""articles get an excerpt, a cover image, a series and a pin

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

VERSIONED = ("working_drafts", "published_versions")


def upgrade() -> None:
    op.create_table(
        "series",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    for table in VERSIONED:
        op.add_column(table, sa.Column("excerpt", sa.Text, nullable=False, server_default=""))
        op.add_column(table, sa.Column("cover", sa.String(80)))
        op.add_column(table, sa.Column("series_id", sa.Integer, sa.ForeignKey("series.id")))
    op.add_column("articles", sa.Column("pinned_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("articles", "pinned_at")
    for table in VERSIONED:
        op.drop_column(table, "series_id")
        op.drop_column(table, "cover")
        op.drop_column(table, "excerpt")
    op.drop_table("series")
