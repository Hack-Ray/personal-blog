from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint, func
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


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    doc_id: Mapped[str] = mapped_column(String(26), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    draft: Mapped["WorkingDraft"] = relationship(back_populates="article", uselist=False)


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
