"""articles remember when they were first published

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("articles", sa.Column("first_published_at", sa.DateTime(timezone=True)))
    op.execute(
        "UPDATE articles SET first_published_at = v.oldest_surviving_published_at"
        " FROM (SELECT article_id, min(published_at) AS oldest_surviving_published_at FROM published_versions GROUP BY article_id) v"
        " WHERE v.article_id = articles.id"
    )
    op.create_check_constraint(
        "articles_public_has_first_published_at",
        "articles",
        "state NOT IN ('published', 'archived') OR first_published_at IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("articles_public_has_first_published_at", "articles")
    op.drop_column("articles", "first_published_at")
