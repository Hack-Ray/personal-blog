"""Content Exporter (Addendum 02, PUB-003).

Reads the public state in one REPEATABLE READ transaction, renders the whole
snapshot in memory, and only then touches the content repo, so a failed read
never leaves a half-written snapshot behind.
"""

import argparse
import json
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session, selectinload
from ulid import ULID

from blog import images
from blog.db import engine
from blog.models import Article, ArticleState, ImageData, PublishedVersion

SCHEMA_VERSION = 1
SNAPSHOT_PATHS = ("manifest.json", "articles", "images")


class ExportError(Exception):
    pass


@dataclass(frozen=True)
class ExportResult:
    release_id: str
    commit: str
    versions: dict[str, int]


def _json(data: object) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode()


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def render_snapshot(session: Session) -> dict[str, bytes]:
    """Returns the snapshot as {relative path: file bytes}."""
    latest = session.scalars(
        select(PublishedVersion)
        .join(Article)
        .where(Article.state == ArticleState.PUBLISHED)
        .ext(distinct_on(PublishedVersion.article_id))
        .order_by(PublishedVersion.article_id, PublishedVersion.version.desc())
        .options(selectinload(PublishedVersion.topic), selectinload(PublishedVersion.tags))
    ).all()
    doc_ids, first_published = {}, {}
    for id_, doc_id, at in session.execute(select(Article.id, Article.doc_id, Article.first_published_at)):
        doc_ids[id_], first_published[id_] = doc_id, at
    archived = sorted(session.scalars(select(Article.doc_id).where(Article.state == ArticleState.ARCHIVED)))

    files: dict[str, bytes] = {}
    entries = []
    image_ids: set[str] = set()
    for v in sorted(latest, key=lambda v: doc_ids[v.article_id]):
        doc_id = doc_ids[v.article_id]
        entries.append({"doc_id": doc_id, "version": v.version})
        image_ids |= images.refs(v.markdown)
        files[f"articles/{doc_id}.json"] = _json(
            {
                "doc_id": doc_id,
                "version": v.version,
                "title": v.title,
                "topic": {"slug": v.topic.slug, "name": v.topic.name},
                "tags": [{"slug": t.slug, "name": t.name} for t in v.tags],
                "published_at": _iso(first_published[v.article_id]),
                "markdown": v.markdown,
            }
        )
    data = {i: d for i, d in session.execute(select(ImageData.image_id, ImageData.data).where(ImageData.image_id.in_(image_ids)))}
    if missing := image_ids - data.keys():
        raise ExportError(f"published articles reference missing images: {', '.join(sorted(missing))}")
    for image_id, blob in data.items():
        files[f"images/{image_id}"] = blob
    files["manifest.json"] = _json(
        {
            "schema_version": SCHEMA_VERSION,
            "release_id": str(ULID()),
            "created_at": _iso(datetime.now(UTC)),
            "articles": entries,
            "archived_articles": [{"doc_id": d} for d in archived],
        }
    )
    return files


def _read_current(repo: Path) -> dict[str, bytes]:
    current = {}
    for top in SNAPSHOT_PATHS:
        path = repo / top
        for f in [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file()):
            current[f.relative_to(repo).as_posix()] = f.read_bytes()
    return current


def _without_release(manifest: bytes) -> dict:
    data = json.loads(manifest)
    data.pop("release_id", None)
    data.pop("created_at", None)
    return data


def _same_content(new: dict[str, bytes], current: dict[str, bytes]) -> bool:
    if new.keys() != current.keys():
        return False
    if any(new[k] != current[k] for k in new if k != "manifest.json"):
        return False
    return _without_release(new["manifest.json"]) == _without_release(current["manifest.json"])


def write_snapshot(files: dict[str, bytes], repo: Path) -> bool:
    """Makes the repo's snapshot paths match `files`. Returns False, writing
    nothing, when only the release id and timestamp would change."""
    current = _read_current(repo)
    if _same_content(files, current):
        return False
    for stale in current.keys() - files.keys():
        (repo / stale).unlink()
    for rel, data in files.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_bytes(data)
    return True


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def _stage(repo: Path) -> None:
    # git add fails on a pathspec that matches nothing, e.g. images/ before the
    # first image is published.
    tracked = set(_git(repo, "ls-files").splitlines())
    paths = [p for p in SNAPSHOT_PATHS if (repo / p).exists() or any(t == p or t.startswith(f"{p}/") for t in tracked)]
    _git(repo, "add", "--all", "--", *paths)


def push(repo: Path) -> None:
    _git(repo, "push", "--quiet")


def export(repo: Path, push_commit: bool = False) -> ExportResult | None:
    """Exports the current public state into `repo` as one commit. Returns
    None when the published content did not change."""
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn, Session(bind=conn) as session:
        files = render_snapshot(session)
    if not write_snapshot(files, repo):
        return None
    manifest = json.loads(files["manifest.json"])
    _stage(repo)
    _git(repo, "commit", "--quiet", "-m", f"Release {manifest['release_id']}")
    if push_commit:
        push(repo)
    return ExportResult(
        release_id=manifest["release_id"],
        commit=_git(repo, "rev-parse", "HEAD").strip(),
        versions={a["doc_id"]: a["version"] for a in manifest["articles"]},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the published site content into the content repo.")
    parser.add_argument("repo", type=Path, help="local clone of personal-blog-content")
    parser.add_argument("--push", action="store_true", help="push the release commit")
    args = parser.parse_args()
    result = export(args.repo, push_commit=args.push)
    print(f"Released {result.release_id}" if result else "No changes to publish")


if __name__ == "__main__":
    main()
