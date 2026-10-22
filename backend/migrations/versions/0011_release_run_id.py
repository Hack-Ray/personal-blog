"""releases remember their workflow run and when they were dispatched

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("releases", sa.Column("run_id", sa.BigInteger()))
    op.add_column("releases", sa.Column("dispatched_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE releases SET dispatched_at = updated_at WHERE status IN ('dispatched', 'building')")


def downgrade() -> None:
    op.drop_column("releases", "dispatched_at")
    op.drop_column("releases", "run_id")
