"""profile for the About page

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# A placeholder the author replaces in the CMS (網站與關於) before the first release.
SEED = {
    "name": "Your Name",
    "headline": "",
    "intro": "",
    "links": [],
    "experience": [],
    "projects": [],
}


def upgrade() -> None:
    profile = op.create_table(
        "profile",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("revision", sa.Integer, nullable=False, server_default="1"),
        sa.Column("content", JSONB, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("id = 1", name="profile_single_row"),
    )
    op.bulk_insert(profile, [{"id": 1, "content": SEED}])


def downgrade() -> None:
    op.drop_table("profile")
