from datetime import datetime
from enum import StrEnum

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, LargeBinary, String, Table, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from blog.db import Base


class Topic(Base):
    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(100))


working_draft_tags = Table(
    "working_draft_tags",
    Base.metadata,
    Column("article_id", ForeignKey("working_drafts.article_id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

published_version_tags = Table(
    "published_version_tags",
    Base.metadata,
    Column("published_version_id", ForeignKey("published_versions.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class ArticleState(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"
    PENDING_DELETION = "pending_deletion"


_state = Enum(ArticleState, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(26), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    state: Mapped[ArticleState] = mapped_column(_state, default=ArticleState.DRAFT)
    # Set only while pending deletion; restore returns to state_before_deletion.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state_before_deletion: Mapped[ArticleState | None] = mapped_column(_state)

    draft: Mapped["WorkingDraft"] = relationship(
        back_populates="article", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )


class WorkingDraft(Base):
    """Mutable editing state; exactly one per article (ART-020)."""

    __tablename__ = "working_drafts"

    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(Text)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"))
    markdown: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    article: Mapped[Article] = relationship(back_populates="draft")
    topic: Mapped[Topic] = relationship()
    tags: Mapped[list[Tag]] = relationship(secondary=working_draft_tags, order_by=Tag.slug)


class PublishedVersion(Base):
    """Immutable snapshot of a draft; a database trigger rejects UPDATE (ART-020)."""

    __tablename__ = "published_versions"
    __table_args__ = (UniqueConstraint("article_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"))
    markdown: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    topic: Mapped[Topic] = relationship()
    tags: Mapped[list[Tag]] = relationship(secondary=published_version_tags, order_by=Tag.slug)


class RetiredDocId(Base):
    """doc_ids of permanently deleted articles, never assigned again (Baseline 4.1)."""

    __tablename__ = "retired_doc_ids"

    doc_id: Mapped[str] = mapped_column(String(26), primary_key=True)
    retired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Image(Base):
    """Index entry for an uploaded image; `id` is `<sha256>.<ext>`, so its
    bytes can never change (Baseline 8.1)."""

    __tablename__ = "images"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(40))
    byte_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Start of the current stretch with no reference; NULL while referenced.
    unreferenced_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImageData(Base):
    __tablename__ = "image_data"

    image_id: Mapped[str] = mapped_column(ForeignKey("images.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class DraftSnapshot(Base):
    """Earlier Markdown of a Working Draft, kept for recovery while editing
    (Baseline 6.2). Removed once the article is published."""

    __tablename__ = "draft_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    markdown: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminCredential(Base):
    """The single CMS administrator's password hash (Baseline 5.1)."""

    __tablename__ = "admin_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    password_hash: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminSession(Base):
    """A signed-in browser; only the SHA-256 of its cookie token is stored."""

    __tablename__ = "admin_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReleaseStatus(StrEnum):
    EXPORTED = "exported"
    PUSH_FAILED = "push_failed"
    PUSHED = "pushed"
    DISPATCH_FAILED = "dispatch_failed"
    DISPATCHED = "dispatched"
    BUILDING = "building"
    DEPLOYED = "deployed"
    SUPERSEDED = "superseded"
    FAILED = "failed"


class Release(Base):
    """One exported snapshot and how far it got toward GitHub Pages
    (Addendum 02, PUB-004). The database publish and the site deploy are
    separate events (Baseline 9.1)."""

    __tablename__ = "releases"

    id: Mapped[str] = mapped_column(String(26), primary_key=True)
    content_commit: Mapped[str] = mapped_column(String(40))
    status: Mapped[ReleaseStatus] = mapped_column(
        Enum(ReleaseStatus, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])
    )
    detail: Mapped[str | None] = mapped_column(Text)
    run_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReleaseArticle(Base):
    """The Published Version of each article a release contains, so cleanup
    can tell which versions the live site was built from (Baseline 6.3)."""

    __tablename__ = "release_articles"

    release_id: Mapped[str] = mapped_column(ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
