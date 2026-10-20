"""releases and the article versions they contain

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "releases",
        sa.Column("id", sa.String(26), primary_key=True),
        sa.Column("content_commit", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("detail", sa.Text),
        sa.Column("run_url", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('exported', 'push_failed', 'pushed', 'dispatch_failed', 'dispatched', 'building',"
            " 'deployed', 'superseded', 'failed')",
            name="releases_status_valid",
        ),
    )
    op.create_table(
        "release_articles",
        sa.Column("release_id", sa.String(26), sa.ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("article_id", sa.Integer, sa.ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("release_articles")
    op.drop_table("releases")
