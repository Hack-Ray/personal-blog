"""sign-in attempts per client, and session idle time

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sign_in_attempts",
        sa.Column("client", sa.Text, primary_key=True),
        sa.Column("failures", sa.Integer, nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "admin_sessions",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Sessions now last 3 days from sign-in (auth.SESSION_TTL), not 7.
    op.execute("UPDATE admin_sessions SET expires_at = least(expires_at, created_at + interval '3 days')")


def downgrade() -> None:
    op.drop_column("admin_sessions", "last_seen_at")
    op.drop_table("sign_in_attempts")
