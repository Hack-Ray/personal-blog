"""Published Version retention (Baseline 6.3)."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from blog.models import Article, ArticleState, PublishedVersion, Release, ReleaseArticle, ReleaseStatus

KEEP_LATEST = 3
_PENDING = (ReleaseStatus.EXPORTED, ReleaseStatus.PUSHED, ReleaseStatus.DISPATCHED, ReleaseStatus.BUILDING)


def cleanup_versions(session: Session) -> list[tuple[str, int]]:
    """Deletes Published Versions that are no longer needed: outside each
    article's newest 3, not part of the live or any in-flight release, and
    replaced by a newer version that has since gone live. Articles pending
    deletion keep everything until restored or purged. Safe to rerun."""
    live = session.scalars(
        select(Release).where(Release.status == ReleaseStatus.DEPLOYED).order_by(Release.id.desc()).limit(1)
    ).first()
    if live is None:
        return []

    protected = set(
        session.execute(
            select(ReleaseArticle.article_id, ReleaseArticle.version)
            .join(Release)
            .where((Release.id == live.id) | Release.status.in_(_PENDING))
        ).all()
    )
    rank = func.row_number().over(partition_by=PublishedVersion.article_id, order_by=PublishedVersion.version.desc())
    ranked = (
        select(PublishedVersion.id, PublishedVersion.article_id, PublishedVersion.version, rank.label("rank"))
        .join(Article)
        .where(Article.state != ArticleState.PENDING_DELETION)
        .subquery()
    )
    # A newer version published before the live release was created is
    # what the live site shows (or replaced), so this one is safe to drop.
    newer_live = (
        select(PublishedVersion.id)
        .where(
            PublishedVersion.article_id == ranked.c.article_id,
            PublishedVersion.version > ranked.c.version,
            PublishedVersion.published_at <= live.created_at,
        )
        .exists()
    )
    candidates = session.execute(
        select(ranked.c.id, ranked.c.article_id, ranked.c.version).where(ranked.c.rank > KEEP_LATEST, newer_live)
    ).all()
    doomed = [(id_, a, v) for id_, a, v in candidates if (a, v) not in protected]
    if not doomed:
        return []
    doc_ids = dict(session.execute(select(Article.id, Article.doc_id).where(Article.id.in_({a for _, a, _ in doomed}))).all())
    session.execute(PublishedVersion.__table__.delete().where(PublishedVersion.id.in_([id_ for id_, _, _ in doomed])))
    session.commit()
    return sorted((doc_ids[a], v) for _, a, v in doomed)
