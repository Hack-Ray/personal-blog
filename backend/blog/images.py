"""Images uploaded from the editor (Baseline 5.2, 8.1, 8.3)."""

import hashlib
import io
from datetime import datetime, timedelta

from markdown_it import MarkdownIt
from PIL import Image as Pillow
from PIL import ImageOps, ImageSequence
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from blog.models import DraftSnapshot, Image, ImageData, Profile, PublishedVersion, WorkingDraft

MAX_BYTES = 10 * 1024 * 1024
# Twice the 720px article column, so screenshots stay sharp on HiDPI screens (BE-014).
MAX_WIDTH = 1440
WEBP_QUALITY = 85
# Decoding holds every pixel in memory: about 4 bytes each, so 40M pixels is
# 160 MB. An animation's frames are all decoded, so they share one budget.
MAX_PIXELS = 40_000_000
MAX_FRAMES = 300
Pillow.MAX_IMAGE_PIXELS = MAX_PIXELS
GRACE = timedelta(days=7)

# Detected from the bytes, never from the client's filename or header.
SIGNATURES: list[tuple[bytes, int, str, str]] = [
    (b"\x89PNG\r\n\x1a\n", 0, "png", "image/png"),
    (b"\xff\xd8\xff", 0, "jpg", "image/jpeg"),
    (b"GIF87a", 0, "gif", "image/gif"),
    (b"GIF89a", 0, "gif", "image/gif"),
    (b"WEBP", 8, "webp", "image/webp"),
]

MARKDOWN = MarkdownIt("commonmark")


class UnsupportedImage(Exception):
    pass


class ImageTooLarge(Exception):
    pass


def _sniff(data: bytes) -> tuple[str, str]:
    for magic, offset, ext, content_type in SIGNATURES:
        if data[offset : offset + len(magic)] == magic and (ext != "webp" or data[:4] == b"RIFF"):
            return ext, content_type
    raise UnsupportedImage("only PNG, JPEG, GIF and WebP images are accepted")


def _fit(frame: Pillow.Image) -> Pillow.Image:
    frame = frame.convert("RGBA" if frame.has_transparency_data else "RGB")
    if frame.width > MAX_WIDTH:
        frame = frame.resize((MAX_WIDTH, max(1, round(frame.height * MAX_WIDTH / frame.width))), Pillow.Resampling.LANCZOS)
    return frame


def _too_many_pixels() -> ImageTooLarge:
    return ImageTooLarge(f"images are limited to {MAX_PIXELS // 1_000_000} million pixels, counting every frame")


def _to_webp(data: bytes) -> bytes:
    """Shrinks to MAX_WIDTH and re-encodes as WebP, keeping animation.

    Re-encoding also drops EXIF metadata such as a photo's GPS location."""
    try:
        with Pillow.open(io.BytesIO(data)) as im:
            # A multi-picture JPEG (MPO) is a photo plus extra pictures such as
            # a preview or depth map; only the photo is kept.
            animated = getattr(im, "is_animated", False) and im.format != "MPO"
            frames = im.n_frames if animated else 1
            if frames > MAX_FRAMES:
                raise ImageTooLarge(f"animations are limited to {MAX_FRAMES} frames")
            if im.width * im.height * frames > MAX_PIXELS:
                raise _too_many_pixels()
            out = io.BytesIO()
            if animated:
                first, frames, durations = im.size, [], []
                for frame in ImageSequence.Iterator(im):
                    # A GIF frame can grow the canvas past the size checked above.
                    if frame.size != first:
                        raise UnsupportedImage("every frame of an animation must be the same size")
                    frames.append(_fit(frame))
                    durations.append(frame.info.get("duration", 100))
                frames[0].save(
                    out,
                    "WEBP",
                    save_all=True,
                    append_images=frames[1:],
                    duration=durations,
                    loop=im.info.get("loop", 0),
                    quality=WEBP_QUALITY,
                )
            else:
                _fit(ImageOps.exif_transpose(im)).save(out, "WEBP", quality=WEBP_QUALITY)
            return out.getvalue()
    except Pillow.DecompressionBombError as e:
        raise _too_many_pixels() from e
    except (OSError, SyntaxError, ValueError) as e:
        raise UnsupportedImage("the image could not be read") from e


def store(session: Session, data: bytes) -> Image:
    """Stores an upload as WebP. Uploading the same bytes again returns the same image."""
    if len(data) > MAX_BYTES:
        raise ImageTooLarge(f"images are limited to {MAX_BYTES // (1024 * 1024)} MB")
    _sniff(data)
    data, content_type = _to_webp(data), "image/webp"
    image_id = f"{hashlib.sha256(data).hexdigest()}.webp"
    inserted = session.execute(
        insert(Image).values(id=image_id, content_type=content_type, byte_size=len(data)).on_conflict_do_nothing(index_elements=["id"]).returning(Image.id)
    ).scalar()
    if inserted:
        session.add(ImageData(image_id=image_id, data=data))
    session.commit()
    return session.get_one(Image, image_id)


def load(session: Session, image_id: str) -> tuple[Image, bytes] | None:
    row = session.execute(select(Image, ImageData.data).join(ImageData, ImageData.image_id == Image.id).where(Image.id == image_id)).one_or_none()
    return (row[0], row[1]) if row else None


def refs(markdown: str) -> set[str]:
    inline = (child for token in MARKDOWN.parse(markdown) for child in token.children or [])
    srcs = (str(t.attrGet("src")) for t in inline if t.type == "image")
    return {src.removeprefix("images/") for src in srcs if src.startswith("images/")}


def missing(session: Session, markdown: str) -> set[str]:
    """Image ids the Markdown references that are not stored."""
    ids = refs(markdown)
    return ids - set(session.scalars(select(Image.id).where(Image.id.in_(ids)))) if ids else set()


def mark_referenced(session: Session, markdown: str) -> None:
    """Called whenever a draft is written, so an image's grace period starts
    no earlier than the last time something pointed at it."""
    ids = refs(markdown)
    if ids:
        session.execute(update(Image).where(Image.id.in_(ids)).values(unreferenced_since=None))


def collect_garbage(session: Session, now: datetime) -> list[str]:
    """Deletes images with no reference for at least 7 days (Baseline 8.3).

    References come from every Working Draft, Draft Snapshot, retained
    Published Version and the profile intro; articles pending deletion keep all three, so their
    images survive the 30-day restore window. The share locks stop drafts from gaining a
    reference between the scan and the delete. Safe to run any number of times.
    """
    session.execute(text("LOCK TABLE working_drafts, draft_snapshots, published_versions, profile IN SHARE MODE"))
    referenced: set[str] = set()
    sources = select(WorkingDraft.markdown).union_all(
        select(DraftSnapshot.markdown), select(PublishedVersion.markdown), select(Profile.content["intro"].astext)
    )
    for (markdown,) in session.execute(sources):
        referenced |= refs(markdown)

    session.execute(update(Image).where(Image.id.in_(referenced)).values(unreferenced_since=None))
    session.execute(update(Image).where(Image.id.not_in(referenced), Image.unreferenced_since.is_(None)).values(unreferenced_since=now))
    expired = list(session.scalars(select(Image.id).where(Image.id.not_in(referenced), Image.unreferenced_since <= now - GRACE)))
    if expired:
        session.execute(Image.__table__.delete().where(Image.id.in_(expired)))
    session.commit()
    return sorted(expired)
