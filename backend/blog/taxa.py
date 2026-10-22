"""Topic, Tag and Series management: rename, merge and delete (BE-019)."""

from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import delete, func, insert, literal, select, update
from sqlalchemy.orm import Session

from blog.models import (
    Article,
    ArticleState,
    PublishedVersion,
    Series,
    Tag,
    Topic,
    WorkingDraft,
    published_version_tags,
    working_draft_tags,
)


class Kind(StrEnum):
    TOPICS = "topics"
    TAGS = "tags"
    SERIES = "series"


MODEL = {Kind.TOPICS: Topic, Kind.TAGS: Tag, Kind.SERIES: Series}
# The column on drafts and versions that points at a topic or series; tags use join tables.
COLUMN = {Kind.TOPICS: "topic_id", Kind.SERIES: "series_id"}


class TaxonNotFound(Exception):
    pass


class TaxonInUse(Exception):
    pass


class InvalidMerge(Exception):
    pass


@dataclass(frozen=True)
class TaxonUsage:
    slug: str
    name: str
    articles: int
    """Live articles whose Working Draft uses it."""
    in_use: bool
    """Referenced by any draft or retained Published Version."""


def _get(session: Session, kind: Kind, slug: str):
    row = session.scalars(select(MODEL[kind]).where(MODEL[kind].slug == slug).with_for_update()).one_or_none()
    if row is None:
        raise TaxonNotFound(f"{kind} {slug}")
    return row


def _draft_refs(kind: Kind):
    """(taxon id, article id) for every Working Draft reference."""
    if kind is Kind.TAGS:
        return select(working_draft_tags.c.tag_id.label("taxon_id"), working_draft_tags.c.article_id)
    column = getattr(WorkingDraft, COLUMN[kind])
    # An article outside any series stores NULL, and a NULL in an IN list makes
    # "not in it" unknown instead of false.
    return select(column.label("taxon_id"), WorkingDraft.article_id).where(column.is_not(None))


def _version_ids(kind: Kind):
    if kind is Kind.TAGS:
        return select(published_version_tags.c.tag_id)
    column = getattr(PublishedVersion, COLUMN[kind])
    return select(column).where(column.is_not(None))


def _in_use(kind: Kind, taxon_id):
    return taxon_id.in_(select(_draft_refs(kind).subquery().c.taxon_id)) | taxon_id.in_(_version_ids(kind))


def usage(session: Session, kind: Kind) -> list[TaxonUsage]:
    model = MODEL[kind]
    refs = _draft_refs(kind).subquery()
    live = (
        select(refs.c.taxon_id, func.count(func.distinct(refs.c.article_id)).label("n"))
        .join(Article, Article.id == refs.c.article_id)
        .where(Article.state != ArticleState.PENDING_DELETION)
        .group_by(refs.c.taxon_id)
        .subquery()
    )
    rows = session.execute(
        select(model.slug, model.name, func.coalesce(live.c.n, 0), _in_use(kind, model.id)).outerjoin(live, live.c.taxon_id == model.id).order_by(model.slug)
    )
    return [TaxonUsage(slug, name, n, in_use) for slug, name, n, in_use in rows]


def _invalidate_drafts(session: Session, kind: Kind, taxon_id: int) -> None:
    """Bumps the revision of every draft that uses the taxon, so an editor still
    holding the old name gets a conflict instead of saving it back (BE-013)."""
    refs = _draft_refs(kind).subquery()
    users = select(refs.c.article_id).where(refs.c.taxon_id == taxon_id)
    session.execute(update(WorkingDraft).where(WorkingDraft.article_id.in_(users)).values(revision=WorkingDraft.revision + 1))


def rename(session: Session, kind: Kind, slug: str, name: str) -> None:
    row = _get(session, kind, slug)
    row.name = name
    _invalidate_drafts(session, kind, row.id)
    session.commit()


def merge(session: Session, kind: Kind, source_slug: str, target_slug: str) -> None:
    """Points every draft and Published Version at the target, then deletes the source."""
    if source_slug == target_slug:
        raise InvalidMerge("cannot merge a taxon into itself")
    source, target = _get(session, kind, source_slug), _get(session, kind, target_slug)
    _invalidate_drafts(session, kind, source.id)
    if kind is Kind.TAGS:
        for table, key in ((working_draft_tags, "article_id"), (published_version_tags, "published_version_id")):
            owner = table.c[key]
            already = select(owner).where(table.c.tag_id == target.id)
            session.execute(
                insert(table).from_select(
                    [key, "tag_id"],
                    select(owner, literal(target.id)).where(table.c.tag_id == source.id, owner.not_in(already)),
                )
            )
            session.execute(delete(table).where(table.c.tag_id == source.id))
    else:
        column = COLUMN[kind]
        for model in (WorkingDraft, PublishedVersion):
            session.execute(update(model).where(getattr(model, column) == source.id).values({column: target.id}))
    session.delete(source)
    session.commit()


def remove(session: Session, kind: Kind, slug: str) -> None:
    """Deletes a taxon nothing refers to any more."""
    row = _get(session, kind, slug)
    if session.scalar(select(_in_use(kind, literal(row.id)))):
        raise TaxonInUse(f"{kind} {slug} is still used")
    session.delete(row)
    session.commit()
