from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from ulid import ULID

from blog import images
from blog.models import Article, ArticleState, DraftSnapshot, PublishedVersion, RetiredDocId, Tag, Topic, WorkingDraft

PENDING_DELETION_RETENTION = timedelta(days=30)
SNAPSHOT_INTERVAL = timedelta(minutes=10)
SNAPSHOT_BIG_CHANGE = 500
SNAPSHOT_LIMIT = 50


@dataclass(frozen=True)
class Taxon:
    slug: str
    name: str


@dataclass(frozen=True)
class DraftContent:
    title: str
    topic: Taxon
    markdown: str
    tags: list[Taxon] = field(default_factory=list)


class Action(StrEnum):
    EDIT = "edit"
    PUBLISH = "publish"
    ARCHIVE = "archive"
    DELETE = "delete"
    RESTORE = "restore"
    PURGE = "purge"


S = ArticleState
LIVE = frozenset({S.DRAFT, S.PUBLISHED, S.ARCHIVED})

# Baseline 7.1-7.4. Each action lists the states it may start from.
ALLOWED_FROM: dict[Action, frozenset[ArticleState]] = {
    Action.EDIT: LIVE,
    Action.PUBLISH: LIVE,
    Action.ARCHIVE: frozenset({S.PUBLISHED}),
    Action.DELETE: LIVE,
    Action.RESTORE: frozenset({S.PENDING_DELETION}),
    Action.PURGE: frozenset({S.PENDING_DELETION}),
}


class ArticleNotFound(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, current_revision: int):
        super().__init__(f"draft is at revision {current_revision}")
        self.current_revision = current_revision


class NotPublishable(Exception):
    pass


class SnapshotNotFound(Exception):
    pass


class InvalidTransition(Exception):
    def __init__(self, action: Action, state: ArticleState):
        super().__init__(f"cannot {action} an article that is {state}")
        self.action = action
        self.state = state


def _get_or_create[T: (Topic, Tag)](session: Session, model: type[T], taxon: Taxon) -> T:
    session.execute(insert(model).values(slug=taxon.slug, name=taxon.name).on_conflict_do_nothing(index_elements=["slug"]))
    return session.scalars(select(model).where(model.slug == taxon.slug)).one()


def _apply(session: Session, draft: WorkingDraft, content: DraftContent) -> None:
    draft.title = content.title
    draft.markdown = content.markdown
    draft.topic = _get_or_create(session, Topic, content.topic)
    draft.tags = [_get_or_create(session, Tag, t) for t in {t.slug: t for t in content.tags}.values()]
    draft.updated_at = func.now()
    images.mark_referenced(session, content.markdown)


def _locked(session: Session, doc_id: str, action: Action) -> Article:
    """Every write takes the article row lock first, which serializes all
    changes to one article."""
    article = session.scalars(select(Article).where(Article.doc_id == doc_id).with_for_update()).one_or_none()
    if article is None:
        raise ArticleNotFound(doc_id)
    if article.state not in ALLOWED_FROM[action]:
        raise InvalidTransition(action, article.state)
    return article


def _locked_draft(session: Session, doc_id: str, action: Action, base_revision: int) -> WorkingDraft:
    draft = _locked(session, doc_id, action).draft
    if draft.revision != base_revision:
        raise RevisionConflict(draft.revision)
    return draft


def _new_doc_id(session: Session) -> str:
    while True:
        doc_id = str(ULID())
        if session.get(RetiredDocId, doc_id) is None:
            return doc_id


def create_article(session: Session, content: DraftContent) -> WorkingDraft:
    article = Article(doc_id=_new_doc_id(session), state=S.DRAFT)
    draft = WorkingDraft(article=article, revision=1)
    _apply(session, draft, content)
    session.add(article)
    session.commit()
    return draft


def get_article(session: Session, doc_id: str) -> Article:
    article = session.scalars(select(Article).where(Article.doc_id == doc_id)).one_or_none()
    if article is None:
        raise ArticleNotFound(doc_id)
    return article


def list_articles(session: Session, state: ArticleState | None = None) -> list[Article]:
    query = select(Article).order_by(Article.created_at.desc())
    if state is not None:
        query = query.where(Article.state == state)
    return list(session.scalars(query))


def _snapshot_before_overwrite(session: Session, draft: WorkingDraft, new_markdown: str) -> None:
    """Keeps the Markdown an Auto Save is about to replace (Baseline 6.2):
    the first change of an editing cycle, then at most one per 10 minutes,
    plus any single change of 500 characters or more."""
    old = draft.markdown
    if old == new_markdown or not old.strip():
        return
    last = session.scalars(
        select(DraftSnapshot).where(DraftSnapshot.article_id == draft.article_id).order_by(DraftSnapshot.id.desc()).limit(1)
    ).first()
    if last is not None and last.markdown == old:
        return
    due = last is None or datetime.now(UTC) - last.created_at >= SNAPSHOT_INTERVAL
    big = abs(len(new_markdown) - len(old)) >= SNAPSHOT_BIG_CHANGE
    if not (due or big):
        return
    session.add(DraftSnapshot(article_id=draft.article_id, revision=draft.revision, markdown=old))
    session.flush()
    keep = (
        select(DraftSnapshot.id)
        .where(DraftSnapshot.article_id == draft.article_id)
        .order_by(DraftSnapshot.id.desc())
        .limit(SNAPSHOT_LIMIT)
    )
    session.execute(
        sql_delete(DraftSnapshot).where(DraftSnapshot.article_id == draft.article_id, DraftSnapshot.id.not_in(keep))
    )


def save_draft(session: Session, doc_id: str, base_revision: int, content: DraftContent) -> WorkingDraft:
    """Auto Save. Rejects a save based on any revision but the current one."""
    draft = _locked_draft(session, doc_id, Action.EDIT, base_revision)
    _snapshot_before_overwrite(session, draft, content.markdown)
    _apply(session, draft, content)
    draft.revision += 1
    session.commit()
    return draft


def publish(session: Session, doc_id: str, base_revision: int, content: DraftContent) -> PublishedVersion:
    """Saves the content the author is looking at and copies it into a new
    PublishedVersion in one transaction. Bumping the revision makes any Auto
    Save still in flight from before the publish fail with RevisionConflict.
    Publishing an archived article republishes it under the same doc_id."""
    if not content.title.strip() or not content.markdown.strip():
        raise NotPublishable("title and markdown must not be empty")
    draft = _locked_draft(session, doc_id, Action.PUBLISH, base_revision)
    _apply(session, draft, content)
    draft.revision += 1
    draft.article.state = S.PUBLISHED
    latest = session.scalar(select(func.max(PublishedVersion.version)).where(PublishedVersion.article_id == draft.article_id))
    version = PublishedVersion(
        article_id=draft.article_id,
        version=(latest or 0) + 1,
        title=draft.title,
        topic=draft.topic,
        tags=list(draft.tags),
        markdown=draft.markdown,
    )
    session.add(version)
    # The new version is durable once this commits, which ends the editing
    # cycle; its snapshots are no longer needed (Baseline 6.2).
    session.execute(sql_delete(DraftSnapshot).where(DraftSnapshot.article_id == draft.article_id))
    session.commit()
    return version


def list_snapshots(session: Session, doc_id: str) -> list[DraftSnapshot]:
    article = get_article(session, doc_id)
    return list(
        session.scalars(select(DraftSnapshot).where(DraftSnapshot.article_id == article.id).order_by(DraftSnapshot.id.desc()))
    )


def restore_snapshot(session: Session, doc_id: str, snapshot_id: int, base_revision: int) -> WorkingDraft:
    """Writes a snapshot's Markdown back through Auto Save, so the content it
    replaces is itself snapshotted and the restore can be undone."""
    article = get_article(session, doc_id)
    snapshot = session.get(DraftSnapshot, snapshot_id)
    if snapshot is None or snapshot.article_id != article.id:
        raise SnapshotNotFound(snapshot_id)
    d = article.draft
    content = DraftContent(
        title=d.title,
        topic=Taxon(d.topic.slug, d.topic.name),
        tags=[Taxon(t.slug, t.name) for t in d.tags],
        markdown=snapshot.markdown,
    )
    return save_draft(session, doc_id, base_revision, content)


def archive(session: Session, doc_id: str) -> Article:
    article = _locked(session, doc_id, Action.ARCHIVE)
    article.state = S.ARCHIVED
    session.commit()
    return article


def delete(session: Session, doc_id: str) -> Article:
    """Moves the article to Pending Deletion, keeping everything restore needs."""
    article = _locked(session, doc_id, Action.DELETE)
    article.state_before_deletion = article.state
    article.state = S.PENDING_DELETION
    article.deleted_at = func.now()
    session.commit()
    return article


def restore(session: Session, doc_id: str) -> Article:
    article = _locked(session, doc_id, Action.RESTORE)
    article.state = article.state_before_deletion
    article.state_before_deletion = None
    article.deleted_at = None
    session.commit()
    return article


def _purge(session: Session, article: Article) -> None:
    session.add(RetiredDocId(doc_id=article.doc_id))
    session.delete(article)


def purge(session: Session, doc_id: str) -> None:
    """Permanently deletes a pending-deletion article before its 30 days end."""
    _purge(session, _locked(session, doc_id, Action.PURGE))
    session.commit()


def purge_expired(session: Session, now: datetime) -> list[str]:
    """Permanently deletes articles pending deletion for 30 days or more.
    Safe to run any number of times; run it on CMS start-up (PUB-005)."""
    expired = session.scalars(
        select(Article)
        .where(Article.state == S.PENDING_DELETION, Article.deleted_at <= now - PENDING_DELETION_RETENTION)
        .with_for_update(skip_locked=True)
    ).all()
    doc_ids = [a.doc_id for a in expired]
    for article in expired:
        _purge(session, article)
    session.commit()
    return doc_ids
