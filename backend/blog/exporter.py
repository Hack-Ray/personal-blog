"""Content Exporter (Addendum 02, PUB-003).

Renders the public state as the files of a content Snapshot. The caller
reads it in one REPEATABLE READ transaction and writes it to the content
repository (content_repository.GitHubRepository).
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session, selectinload
from ulid import ULID

from blog import images
from blog.models import Article, ArticleState, ArticleUrl, ImageData, Profile, PublishedVersion
from blog.profile import ProfileContent

SCHEMA_VERSION = 1


class ExportError(Exception):
    pass


@dataclass(frozen=True)
class ExportResult:
    release_id: str
    commit: str
    versions: dict[str, int]
    parent_commit: str | None = None
    target: str | None = None
    # doc_id -> the URL segment each published or archived article was exported under.
    segments: dict[str, str] = field(default_factory=dict)

    @classmethod
    def of(cls, manifest: dict, commit: str, parent_commit: str | None = None, target: str | None = None) -> "ExportResult":
        return cls(
            release_id=manifest["release_id"],
            commit=commit,
            versions={a["doc_id"]: a["version"] for a in manifest["articles"]},
            parent_commit=parent_commit,
            target=target,
            segments={a["doc_id"]: a.get("slug", a["doc_id"]) for a in manifest["articles"] + manifest["archived_articles"]},
        )


def _json(data: object) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode()


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _url_keys(doc_id: str, slug: str | None, exported: set[str]) -> dict:
    """Left out when unset, so manifests of articles without a slug or an
    earlier URL stay as they were."""
    keys: dict = {"slug": slug} if slug else {}
    if earlier := sorted(exported - {slug or doc_id}):
        keys["redirect_from"] = earlier
    return keys


def render_snapshot(session: Session) -> tuple[dict[str, bytes], set[str]]:
    """Returns the snapshot as {relative path: file bytes} for everything but
    images, and the ids of the images it needs."""
    latest = session.scalars(
        select(PublishedVersion)
        .join(Article)
        .where(Article.state == ArticleState.PUBLISHED)
        .ext(distinct_on(PublishedVersion.article_id))
        .order_by(PublishedVersion.article_id, PublishedVersion.version.desc())
        .options(selectinload(PublishedVersion.topic), selectinload(PublishedVersion.tags), selectinload(PublishedVersion.series))
    ).all()
    doc_ids, first_published, pinned, slugs = {}, {}, {}, {}
    for id_, doc_id, at, pinned_at, slug in session.execute(select(Article.id, Article.doc_id, Article.first_published_at, Article.pinned_at, Article.slug)):
        doc_ids[id_], first_published[id_], pinned[id_], slugs[id_] = doc_id, at, pinned_at, slug
    exported: dict[int, set[str]] = {}
    for article_id, segment in session.execute(select(ArticleUrl.article_id, ArticleUrl.segment)):
        exported.setdefault(article_id, set()).add(segment)
    archived = sorted(session.scalars(select(Article.id).where(Article.state == ArticleState.ARCHIVED)), key=doc_ids.get)

    def url_keys(article_id: int) -> dict:
        return _url_keys(doc_ids[article_id], slugs[article_id], exported.get(article_id, set()))

    files: dict[str, bytes] = {}
    entries = []
    image_ids: set[str] = set()
    for v in sorted(latest, key=lambda v: doc_ids[v.article_id]):
        doc_id = doc_ids[v.article_id]
        entries.append({"doc_id": doc_id, "version": v.version, **url_keys(v.article_id)})
        image_ids |= images.refs(v.markdown)
        article = {
            "doc_id": doc_id,
            "version": v.version,
            "title": v.title,
            "topic": {"slug": v.topic.slug, "name": v.topic.name},
            "tags": [{"slug": t.slug, "name": t.name} for t in v.tags],
            "published_at": _iso(first_published[v.article_id]),
            "markdown": v.markdown,
        }
        # Optional keys are left out when unset, so articles without them export as before.
        if v.version > 1:
            article["updated_at"] = _iso(v.published_at)
        if v.excerpt:
            article["excerpt"] = v.excerpt
        if v.cover:
            article["cover"] = f"images/{v.cover}"
        if v.series:
            article["series"] = {"slug": v.series.slug, "name": v.series.name}
        if pinned[v.article_id]:
            article["pinned_at"] = _iso(pinned[v.article_id])
        files[f"articles/{doc_id}.json"] = _json(article)
    # Validated again so the file has the model's key order, not JSONB's.
    profile = ProfileContent.model_validate(session.get_one(Profile, 1).content)
    files["profile.json"] = _json(profile.public())
    image_ids |= images.refs(profile.intro)
    stored = set(session.scalars(select(ImageData.image_id).where(ImageData.image_id.in_(image_ids))))
    if missing := image_ids - stored:
        raise ExportError(f"published content references missing images: {', '.join(sorted(missing))}")
    files["manifest.json"] = _json(
        {
            "schema_version": SCHEMA_VERSION,
            "release_id": str(ULID()),
            "created_at": _iso(datetime.now(UTC)),
            "articles": entries,
            "archived_articles": [{"doc_id": doc_ids[a], **url_keys(a)} for a in archived],
        }
    )
    return files, image_ids


def _without_release(manifest: bytes) -> dict:
    data = json.loads(manifest)
    data.pop("release_id", None)
    data.pop("created_at", None)
    return data
