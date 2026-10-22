"""Durable website update requests.

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "release_jobs",
        sa.Column("id", sa.String(26), primary_key=True),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("requested_release_id", sa.String(26), sa.ForeignKey("releases.id", ondelete="SET NULL")),
        sa.Column("release_id", sa.String(26), sa.ForeignKey("releases.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("detail", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("action IN ('create', 'retry')", name="release_jobs_action"),
        sa.CheckConstraint("status IN ('queued', 'running', 'completed', 'failed')", name="release_jobs_status"),
    )
    op.create_index("ix_release_jobs_status", "release_jobs", ["status"])


def downgrade() -> None:
    op.drop_table("release_jobs")
