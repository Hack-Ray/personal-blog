"""Images uploaded from the editor (Baseline 5.2, 8.1, 8.3)."""

import hashlib
import re
from datetime import datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from blog.models import Image, ImageData, PublishedVersion, WorkingDraft

MAX_BYTES = 10 * 1024 * 1024
GRACE = timedelta(days=7)

# Detected from the bytes, never from the client's filename or header.
SIGNATURES: list[tuple[bytes, int, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", 0, "png", "image/png"),
    (b"\xff\xd8\xff", 0, "jpg", "image/jpeg"),
    (b"GIF87a", 0, "gif", "image/gif"),
    (b"GIF89a", 0, "gif", "image/gif"),
    (b"WEBP", 8, "webp", "image/webp"),
]

# Snapshot Markdown references images as images/<id> (PUB-003).
IMAGE_REF = re.compile(r"\]\(images/([0-9a-f]{64}\.[a-z]+)\)")


class UnsupportedImage(Exception):
    pass


class ImageTooLarge(Exception):
    pass


def _sniff(data: bytes) -> tuple[str, str]:
    for magic, offset, ext, content_type in SIGNATURES:
        if data[offset : offset + len(magic)] == magic and (ext != "webp" or data[:4] == b"RIFF"):
            return ext, content_type
    raise UnsupportedImage("only PNG, JPEG, GIF and WebP images are accepted")


def store(session: Session, data: bytes) -> Image:
    """Stores an upload. Uploading the same bytes again returns the same image."""
    if len(data) > MAX_BYTES:
        raise ImageTooLarge(f"images are limited to {MAX_BYTES // (1024 * 1024)} MB")
    ext, content_type = _sniff(data)
    image_id = f"{hashlib.sha256(data).hexdigest()}.{ext}"
    inserted = session.execute(
        insert(Image)
        .values(id=image_id, content_type=content_type, byte_size=len(data))
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(Image.id)
    ).scalar()
    if inserted:
        session.add(ImageData(image_id=image_id, data=data))
    session.commit()
    return session.get_one(Image, image_id)


def load(session: Session, image_id: str) -> tuple[Image, bytes] | None:
    row = session.execute(
        select(Image, ImageData.data).join(ImageData, ImageData.image_id == Image.id).where(Image.id == image_id)
    ).one_or_none()
    return (row[0], row[1]) if row else None


def refs(markdown: str) -> set[str]:
    return set(IMAGE_REF.findall(markdown))


def mark_referenced(session: Session, markdown: str) -> None:
    """Called whenever a draft is written, so an image's grace period starts
    no earlier than the last time something pointed at it."""
    ids = refs(markdown)
    if ids:
        session.execute(update(Image).where(Image.id.in_(ids)).values(unreferenced_since=None))


def collect_garbage(session: Session, now: datetime) -> list[str]:
    """Deletes images with no reference for at least 7 days (Baseline 8.3).

    References come from every Working Draft and every retained Published
    Version; articles pending deletion keep both, so their images survive the
    30-day restore window. The share locks stop drafts from gaining a
    reference between the scan and the delete. Safe to run any number of times.
    """
    session.execute(text("LOCK TABLE working_drafts, published_versions IN SHARE MODE"))
    referenced: set[str] = set()
    for (markdown,) in session.execute(select(WorkingDraft.markdown).union_all(select(PublishedVersion.markdown))):
        referenced |= refs(markdown)

    session.execute(update(Image).where(Image.id.in_(referenced)).values(unreferenced_since=None))
    session.execute(
        update(Image)
        .where(Image.id.not_in(referenced), Image.unreferenced_since.is_(None))
        .values(unreferenced_since=now)
    )
    expired = list(
        session.scalars(
            select(Image.id).where(Image.id.not_in(referenced), Image.unreferenced_since <= now - GRACE)
        )
    )
    if expired:
        session.execute(Image.__table__.delete().where(Image.id.in_(expired)))
    session.commit()
    return sorted(expired)
