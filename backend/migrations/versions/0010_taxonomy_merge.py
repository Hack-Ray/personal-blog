"""published versions may be repointed to another topic or series when taxa merge

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Which topic or series a version belongs to is taxonomy identity, like its
    # name (BE-013), so a merge may change it; every other column stays immutable.
    op.execute(
        """
        CREATE FUNCTION reject_published_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF to_jsonb(NEW) - 'topic_id' - 'series_id' = to_jsonb(OLD) - 'topic_id' - 'series_id' THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
        END $$;
        DROP TRIGGER published_versions_immutable ON published_versions;
        CREATE TRIGGER published_versions_immutable BEFORE UPDATE ON published_versions
          FOR EACH ROW EXECUTE FUNCTION reject_published_version_update();
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER published_versions_immutable ON published_versions;
        CREATE TRIGGER published_versions_immutable BEFORE UPDATE ON published_versions
          FOR EACH ROW EXECUTE FUNCTION reject_update();
        DROP FUNCTION reject_published_version_update();
        """
    )
