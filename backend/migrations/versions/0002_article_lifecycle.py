"""article lifecycle states and retired doc ids

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

STATES = "'draft', 'published', 'archived', 'pending_deletion'"


def upgrade() -> None:
    op.add_column("articles", sa.Column("state", sa.String(20), nullable=False, server_default="draft"))
    op.add_column("articles", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("articles", sa.Column("state_before_deletion", sa.String(20)))
    op.execute("UPDATE articles SET state = 'published' WHERE id IN (SELECT article_id FROM published_versions)")
    op.alter_column("articles", "state", server_default=None)
    op.create_check_constraint("articles_state_valid", "articles", f"state IN ({STATES})")
    op.create_check_constraint(
        "articles_pending_deletion_fields",
        "articles",
        "(state = 'pending_deletion') = (deleted_at IS NOT NULL)"
        " AND (state = 'pending_deletion') = (state_before_deletion IS NOT NULL)"
        " AND state_before_deletion IS DISTINCT FROM 'pending_deletion'",
    )
    op.create_check_constraint("articles_state_before_deletion_valid", "articles", f"state_before_deletion IN ({STATES})")
    op.create_table(
        "retired_doc_ids",
        sa.Column("doc_id", sa.String(26), primary_key=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("retired_doc_ids")
    for name in ["articles_state_before_deletion_valid", "articles_pending_deletion_fields", "articles_state_valid"]:
        op.drop_constraint(name, "articles")
    for column in ["state_before_deletion", "deleted_at", "state"]:
        op.drop_column("articles", column)
