"""Content Exporter (Addendum 02, PUB-003).

Reads the public state in one REPEATABLE READ transaction and renders every
file except images in memory before touching the content repo. Images are
written one at a time from the same transaction; an export cut off part-way
is discarded at the start of the next one.
"""

import argparse
import json
import os
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session, selectinload
from ulid import ULID

from blog import images
from blog.db import engine
from blog.models import Article, ArticleState, ArticleUrl, ImageData, Profile, PublishedVersion
from blog.profile import ProfileContent

SCHEMA_VERSION = 1
SNAPSHOT_PATHS = ("manifest.json", "profile.json", "articles", "images")


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


def _current_paths(repo: Path) -> list[str]:
    paths = []
    for top in SNAPSHOT_PATHS:
        path = repo / top
        for f in [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file()):
            paths.append(f.relative_to(repo).as_posix())
    return paths


def _without_release(manifest: bytes) -> dict:
    data = json.loads(manifest)
    data.pop("release_id", None)
    data.pop("created_at", None)
    return data


def _same_content(files: dict[str, bytes], wanted: set[str], current: set[str], repo: Path) -> bool:
    if wanted != current:
        return False
    if any(files[k] != (repo / k).read_bytes() for k in files if k != "manifest.json"):
        return False
    return _without_release(files["manifest.json"]) == _without_release((repo / "manifest.json").read_bytes())


def write_snapshot(files: dict[str, bytes], image_ids: set[str], repo: Path, read_image: Callable[[str], bytes]) -> bool:
    """Makes the repo's snapshot paths match `files` plus `image_ids`. Returns
    False, writing nothing, when only the release id and timestamp would change.

    An image's id is the hash of its bytes, so an image already in the repo is
    never read or rewritten."""
    images_wanted = {f"images/{i}" for i in image_ids}
    wanted = files.keys() | images_wanted
    current = set(_current_paths(repo))
    if _same_content(files, wanted, current, repo):
        return False
    for stale in current - wanted:
        (repo / stale).unlink()
    for rel, data in files.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_bytes(data)
    for rel in sorted(images_wanted - current):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_bytes(read_image(rel.removeprefix("images/")))
    return True


# Seconds before a git command is given up, so a stalled push cannot hold the
# release lock forever.
GIT_TIMEOUT = 120
# Never wait for a password prompt nobody will answer.
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, timeout=GIT_TIMEOUT, env=GIT_ENV).stdout


def _stage(repo: Path) -> None:
    # git add fails on a pathspec that matches nothing, e.g. images/ before the
    # first image is published.
    tracked = set(_git(repo, "ls-files").splitlines())
    paths = [p for p in SNAPSHOT_PATHS if (repo / p).exists() or any(t == p or t.startswith(f"{p}/") for t in tracked)]
    _git(repo, "add", "--all", "--", *paths)


def _has_head(repo: Path) -> bool:
    return subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "--quiet", "HEAD"], capture_output=True).returncode == 0


def _discard_interrupted_export(repo: Path) -> None:
    _git(repo, "rm", "-r", "--quiet", "--cached", "--ignore-unmatch", "--", *SNAPSHOT_PATHS)
    in_head = _git(repo, "ls-tree", "--name-only", "HEAD", "--", *SNAPSHOT_PATHS).split() if _has_head(repo) else []
    if in_head:
        _git(repo, "checkout", "HEAD", "--", *in_head)
    _git(repo, "clean", "-d", "--force", "--quiet", "--", *SNAPSHOT_PATHS)


def head_release(repo: Path) -> ExportResult | None:
    """The release HEAD holds, if HEAD is a release commit made by `export`."""
    if not _has_head(repo):
        return None
    subject = _git(repo, "log", "-1", "--format=%s").strip()
    if not subject.startswith("Release "):
        return None
    manifest = json.loads(_git(repo, "show", "HEAD:manifest.json"))
    if subject != f"Release {manifest['release_id']}":
        return None
    return ExportResult.of(manifest, _git(repo, "rev-parse", "HEAD").strip())


def push(repo: Path) -> None:
    _git(repo, "push", "--quiet")


def unknown_remote_commit(repo: Path) -> str | None:
    """The commit the upstream branch points at, when this clone does not
    have it: someone else, such as another CMS, pushed to the content repo.
    None when the remote holds nothing new or cannot be reached (the push
    then fails on its own)."""
    try:
        branch = _git(repo, "symbolic-ref", "--quiet", "--short", "HEAD").strip()
        remote = _git(repo, "config", f"branch.{branch}.remote").strip()
        ref = _git(repo, "config", f"branch.{branch}.merge").strip()
        line = _git(repo, "ls-remote", remote, ref).split()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    if not line or not _has_head(repo):
        return None
    known = subprocess.run(["git", "-C", str(repo), "merge-base", "--is-ancestor", line[0], "HEAD"], capture_output=True, timeout=GIT_TIMEOUT)
    return None if known.returncode == 0 else line[0]


def export(repo: Path, push_commit: bool = False) -> ExportResult | None:
    """Exports the current public state into `repo` as one commit. Returns
    None when the published content did not change."""
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn, Session(bind=conn) as session:
        files, image_ids = render_snapshot(session)
        _discard_interrupted_export(repo)

        def read_image(image_id: str) -> bytes:
            return session.scalars(select(ImageData.data).where(ImageData.image_id == image_id)).one()

        if not write_snapshot(files, image_ids, repo, read_image):
            return None
    manifest = json.loads(files["manifest.json"])
    _stage(repo)
    _git(repo, "commit", "--quiet", "-m", f"Release {manifest['release_id']}")
    if push_commit:
        push(repo)
    return head_release(repo)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the published site content into the content repo.")
    parser.add_argument("repo", type=Path, help="local clone of personal-blog-content")
    parser.add_argument("--push", action="store_true", help="push the release commit")
    args = parser.parse_args()
    result = export(args.repo, push_commit=args.push)
    print(f"Released {result.release_id}" if result else "No changes to publish")


if __name__ == "__main__":
    main()
