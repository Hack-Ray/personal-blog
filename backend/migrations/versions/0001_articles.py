"""articles, working drafts and published versions

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topics",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    op.create_table(
        "articles",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("doc_id", sa.String(26), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("doc_id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{25}$'", name="articles_doc_id_ulid"),
    )
    op.create_table(
        "working_drafts",
        sa.Column("article_id", sa.Integer, sa.ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("topic_id", sa.Integer, sa.ForeignKey("topics.id"), nullable=False),
        sa.Column("markdown", sa.Text, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "working_draft_tags",
        sa.Column("article_id", sa.Integer, sa.ForeignKey("working_drafts.article_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id"), primary_key=True),
    )
    op.create_table(
        "published_versions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("article_id", sa.Integer, sa.ForeignKey("articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("topic_id", sa.Integer, sa.ForeignKey("topics.id"), nullable=False),
        sa.Column("markdown", sa.Text, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("article_id", "version"),
    )
    op.create_table(
        "published_version_tags",
        sa.Column(
            "published_version_id", sa.Integer, sa.ForeignKey("published_versions.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id"), primary_key=True),
    )
    # Published versions are append-only (ART-020). DELETE stays allowed for
    # retention cleanup (Baseline 6.3).
    op.execute(
        """
        CREATE FUNCTION reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
        END $$;
        CREATE TRIGGER published_versions_immutable BEFORE UPDATE ON published_versions
          FOR EACH ROW EXECUTE FUNCTION reject_update();
        CREATE TRIGGER published_version_tags_immutable BEFORE UPDATE ON published_version_tags
          FOR EACH ROW EXECUTE FUNCTION reject_update();
        """
    )


def downgrade() -> None:
    for table in ["published_version_tags", "published_versions", "working_draft_tags", "working_drafts", "articles", "tags", "topics"]:
        op.drop_table(table)
    op.execute("DROP FUNCTION reject_update()")
