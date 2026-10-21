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

# What frontend/src/profile.ts held, so the site does not change until the author edits it.
SEED = {
    "name": "Hack-Ray",
    "headline": "",
    "intro": "",
    "links": [{"label": "GitHub", "url": "https://github.com/Hack-Ray"}],
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
