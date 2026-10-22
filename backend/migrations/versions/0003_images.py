"""uploaded images

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "images",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("content_type", sa.String(40), nullable=False),
        sa.Column("byte_size", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("unreferenced_since", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("id ~ '^[0-9a-f]{64}\\.(png|jpg|gif|webp)$'", name="images_id_content_hash"),
    )
    op.create_table(
        "image_data",
        sa.Column("image_id", sa.String(80), sa.ForeignKey("images.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("data", sa.LargeBinary, nullable=False),
    )
    # Image bytes are addressed by their hash, so they must never change.
    op.execute("CREATE TRIGGER image_data_immutable BEFORE UPDATE ON image_data FOR EACH ROW EXECUTE FUNCTION reject_update()")


def downgrade() -> None:
    op.drop_table("image_data")
    op.drop_table("images")
