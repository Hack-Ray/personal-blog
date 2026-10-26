"""articles get an optional slug and remember the URLs they were exported under

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("articles", sa.Column("slug", sa.String(80), unique=True))
    op.create_table(
        "article_urls",
        sa.Column("segment", sa.String(80), primary_key=True),
        sa.Column("article_id", sa.Integer, sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    # Every article published so far was exported under its doc_id, unless no release followed; an extra redirect is harmless.
    op.execute("INSERT INTO article_urls (segment, article_id) SELECT doc_id, id FROM articles WHERE first_published_at IS NOT NULL")


def downgrade() -> None:
    op.drop_table("article_urls")
    op.drop_column("articles", "slug")
