"""Remember the immutable commit's parent and publication destination."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("releases", sa.Column("content_parent", sa.String(40), nullable=True))
    op.add_column("releases", sa.Column("content_target", sa.Text(), nullable=True))
    op.add_column("releases", sa.Column("deployment_target", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("releases", "deployment_target")
    op.drop_column("releases", "content_target")
    op.drop_column("releases", "content_parent")
