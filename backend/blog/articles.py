from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from ulid import ULID

from blog.models import Article, PublishedVersion, Tag, Topic, WorkingDraft


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


class ArticleNotFound(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, current_revision: int):
        super().__init__(f"draft is at revision {current_revision}")
        self.current_revision = current_revision


class NotPublishable(Exception):
    pass


def _get_or_create[T: (Topic, Tag)](session: Session, model: type[T], taxon: Taxon) -> T:
    session.execute(insert(model).values(slug=taxon.slug, name=taxon.name).on_conflict_do_nothing(index_elements=["slug"]))
    return session.scalars(select(model).where(model.slug == taxon.slug)).one()


def _apply(session: Session, draft: WorkingDraft, content: DraftContent) -> None:
    draft.title = content.title
    draft.markdown = content.markdown
    draft.topic = _get_or_create(session, Topic, content.topic)
    draft.tags = [_get_or_create(session, Tag, t) for t in {t.slug: t for t in content.tags}.values()]
    draft.updated_at = func.now()


def _locked_draft(session: Session, doc_id: str, base_revision: int) -> WorkingDraft:
    draft = session.scalars(
        select(WorkingDraft).join(Article).where(Article.doc_id == doc_id).with_for_update(of=WorkingDraft)
    ).one_or_none()
    if draft is None:
        raise ArticleNotFound(doc_id)
    if draft.revision != base_revision:
        raise RevisionConflict(draft.revision)
    return draft


def create_article(session: Session, content: DraftContent) -> WorkingDraft:
    article = Article(doc_id=str(ULID()))
    draft = WorkingDraft(article=article, revision=1)
    _apply(session, draft, content)
    session.add(article)
    session.commit()
    return draft


def get_draft(session: Session, doc_id: str) -> WorkingDraft:
    draft = session.scalars(select(WorkingDraft).join(Article).where(Article.doc_id == doc_id)).one_or_none()
    if draft is None:
        raise ArticleNotFound(doc_id)
    return draft


def save_draft(session: Session, doc_id: str, base_revision: int, content: DraftContent) -> WorkingDraft:
    """Auto Save. Rejects a save based on any revision but the current one."""
    draft = _locked_draft(session, doc_id, base_revision)
    _apply(session, draft, content)
    draft.revision += 1
    session.commit()
    return draft


def publish(session: Session, doc_id: str, base_revision: int, content: DraftContent) -> PublishedVersion:
    """Saves the content the author is looking at and copies it into a new
    PublishedVersion in one transaction. Bumping the revision makes any Auto
    Save still in flight from before the publish fail with RevisionConflict."""
    if not content.title.strip() or not content.markdown.strip():
        raise NotPublishable("title and markdown must not be empty")
    draft = _locked_draft(session, doc_id, base_revision)
    _apply(session, draft, content)
    draft.revision += 1
    # The draft row lock serializes publishes of one article, so max + 1 is safe.
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
    session.commit()
    return version
