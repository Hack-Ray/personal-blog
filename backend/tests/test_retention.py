from itertools import count

from sqlalchemy import select

from blog import articles
from blog.db import SessionLocal
from blog.models import PublishedVersion, Release, ReleaseArticle, ReleaseStatus
from blog.retention import cleanup_versions

R = ReleaseStatus
BACKEND = articles.Taxon("backend", "Backend")
_release_ids = count(1)


def content(markdown):
    return articles.DraftContent("T", BACKEND, markdown)


def article_with_versions(s, n):
    draft = articles.create_article(s, content("v0"))
    for v in range(1, n + 1):
        articles.publish(s, draft.article.doc_id, draft.revision, content(f"v{v}"))
    return draft.article


def release(s, status, versions):
    """versions: {article: version}; created now, after everything published so far."""
    r = Release(id=f"01M{next(_release_ids):023d}", content_commit="c" * 40, status=status)
    s.add(r)
    s.flush()
    for article, version in versions.items():
        s.add(ReleaseArticle(release_id=r.id, article_id=article.id, version=version))
    s.commit()
    return r


def versions(s, article):
    return list(s.scalars(select(PublishedVersion.version).where(PublishedVersion.article_id == article.id).order_by(PublishedVersion.version)))


def test_nothing_is_deleted_before_any_release_goes_live():
    with SessionLocal() as s:
        a = article_with_versions(s, 6)
        release(s, R.BUILDING, {a: 6})
        assert cleanup_versions(s) == []
        assert versions(s, a) == [1, 2, 3, 4, 5, 6]


def test_keeps_the_newest_three_once_a_newer_version_is_live():
    with SessionLocal() as s:
        a = article_with_versions(s, 5)
        release(s, R.DEPLOYED, {a: 5})
        assert cleanup_versions(s) == [(a.doc_id, 1), (a.doc_id, 2)]
        assert versions(s, a) == [3, 4, 5]
        assert cleanup_versions(s) == []


def test_versions_in_an_in_flight_release_are_kept():
    with SessionLocal() as s:
        a = article_with_versions(s, 5)
        release(s, R.DISPATCHED, {a: 1})
        release(s, R.DEPLOYED, {a: 5})
        assert cleanup_versions(s) == [(a.doc_id, 2)]
        assert versions(s, a) == [1, 3, 4, 5]


def test_waits_until_a_newer_version_has_gone_live():
    with SessionLocal() as s:
        other = article_with_versions(s, 1)
        a = article_with_versions(s, 1)
        release(s, R.DEPLOYED, {other: 1})
        for v in range(2, 5):
            articles.publish(s, a.doc_id, a.draft.revision, content(f"v{v}"))
        assert cleanup_versions(s) == []
        assert versions(s, a) == [1, 2, 3, 4]

        release(s, R.DEPLOYED, {other: 1})
        assert cleanup_versions(s) == [(a.doc_id, 1)]


def test_failed_or_superseded_releases_do_not_count_as_live():
    with SessionLocal() as s:
        a = article_with_versions(s, 5)
        release(s, R.FAILED, {a: 5})
        release(s, R.SUPERSEDED, {a: 5})
        assert cleanup_versions(s) == []


def test_articles_pending_deletion_keep_every_version():
    with SessionLocal() as s:
        a = article_with_versions(s, 5)
        release(s, R.DEPLOYED, {a: 5})
        articles.delete(s, a.doc_id)
        assert cleanup_versions(s) == []
        assert versions(s, a) == [1, 2, 3, 4, 5]
