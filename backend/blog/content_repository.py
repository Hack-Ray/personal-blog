import argparse
import base64
import hashlib
import json
import tempfile
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from blog import exporter
from blog.db import SessionLocal, engine
from blog.github import GitHubClient, GitHubError
from blog.models import ImageData, Release


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def managed(path: str) -> bool:
    return path in ("manifest.json", "profile.json") or path.startswith(("articles/", "images/"))


class GitHubRepository:
    def __init__(self, client: GitHubClient, repo: str, branch: str):
        self.client, self.repo, self.branch = client, repo, branch
        self.prefix = f"/repos/{repo}/git"
        self.target = f"{client.api_url}/{repo}#{branch}"

    def head(self) -> str:
        try:
            return self.client.call("GET", f"{self.prefix}/ref/heads/{quote(self.branch, safe='/')}")["object"]["sha"]
        except GitHubError as e:
            if e.status == 404:
                raise exporter.ExportError("CONTENT_BRANCH must exist; initialize the content repository with a README first") from e
            raise

    def tree(self, commit: str) -> tuple[str, dict[str, dict]]:
        tree_sha = self.client.call("GET", f"{self.prefix}/commits/{commit}")["tree"]["sha"]
        result = self.client.call("GET", f"{self.prefix}/trees/{tree_sha}?recursive=1")
        if result.get("truncated"):
            raise exporter.ExportError("content repository tree is truncated; publication refused")
        return tree_sha, {item["path"]: item for item in result["tree"] if item["type"] != "tree"}

    def read_blob(self, sha: str) -> bytes:
        blob = self.client.call("GET", f"{self.prefix}/blobs/{sha}")
        if blob.get("encoding") != "base64":
            raise exporter.ExportError("unsupported GitHub blob encoding")
        return base64.b64decode(blob["content"])

    def prepare(self, last: Release | None, *, adopt: bool = False) -> exporter.ExportResult | None:
        parent = self.head()
        tree_sha, current = self.tree(parent)
        if last is not None and (last.content_commit != parent or last.content_target not in (None, self.target)):
            raise exporter.ExportError("content repository HEAD or destination changed; another CMS may be in use")
        if last is None and "manifest.json" in current and not adopt:
            raise exporter.ExportError("existing remote Snapshot has no local release history; restore its database or run the verified adopt command")
        with tempfile.TemporaryDirectory(prefix="blog-snapshot-") as tmp:
            root = Path(tmp)
            with engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn, Session(bind=conn) as session:
                files, ids = exporter.render_snapshot(session)
                for path, data in files.items():
                    dest = root / path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                for image_id in sorted(ids):
                    dest = root / "images" / image_id
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(session.scalars(select(ImageData.data).where(ImageData.image_id == image_id)).one())
            wanted = files.keys() | {f"images/{i}" for i in ids}
            existing = {path for path in current if managed(path)}
            same = wanted == existing
            if same:
                same = all(
                    current[path]["mode"] == "100644" and current[path]["sha"] == blob_sha((root / path).read_bytes())
                    for path in wanted
                    if path != "manifest.json"
                )
            old_manifest = None
            if same:
                old_manifest = self.read_blob(current["manifest.json"]["sha"])
                same = exporter._without_release(old_manifest) == exporter._without_release(files["manifest.json"])
            if adopt:
                if not same or old_manifest is None:
                    raise exporter.ExportError("remote Snapshot differs from this database; adoption refused")
                return self._result(json.loads(old_manifest), parent, None)
            if same:
                return None
            entries = [{"path": p, "mode": current[p]["mode"], "type": current[p]["type"], "sha": None} for p in sorted(existing - wanted)]
            for path in sorted(wanted):
                data = (root / path).read_bytes()
                sha = blob_sha(data)
                if current.get(path, {}).get("sha") == sha and current[path]["mode"] == "100644":
                    continue
                uploaded = self.client.call("POST", f"{self.prefix}/blobs", {"content": base64.b64encode(data).decode(), "encoding": "base64"})
                if uploaded["sha"] != sha:
                    raise exporter.ExportError("GitHub returned an unexpected blob hash")
                entries.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
            tree = self.client.call("POST", f"{self.prefix}/trees", {"base_tree": tree_sha, "tree": entries})
            manifest = json.loads(files["manifest.json"])
            commit = self.client.call(
                "POST",
                f"{self.prefix}/commits",
                {
                    "message": f"Release {manifest['release_id']}",
                    "tree": tree["sha"],
                    "parents": [parent],
                },
            )
            return self._result(manifest, commit["sha"], parent)

    def _result(self, manifest: dict, commit: str, parent: str | None) -> exporter.ExportResult:
        return exporter.ExportResult.of(manifest, commit, parent, self.target)

    def publish(self, release: Release) -> None:
        if release.content_target != self.target:
            raise exporter.ExportError("release destination differs from current settings; restore the original settings before retrying")
        head = self.head()
        if head == release.content_commit:
            return
        if head != release.content_parent:
            raise exporter.ExportError("content repository changed after export; refusing to overwrite another writer")
        self.client.call("PATCH", f"{self.prefix}/refs/heads/{quote(self.branch, safe='/')}", {"sha": release.content_commit, "force": False})


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify and adopt a content HEAD after restoring a matching database. Does not write to GitHub.")
    parser.add_argument("action", choices=["adopt"])
    parser.parse_args()
    from blog import release
    from blog.models import ReleaseStatus

    repo = release.repo_from_env()
    if not isinstance(repo, GitHubRepository):
        parser.error("adoption requires CONTENT_TRANSPORT=api")
    with release.exclusive(), SessionLocal() as session:
        if release.latest(session) is not None:
            parser.error("database already has release history; restore the correct database instead")
        result = repo.prepare(None, adopt=True)
        record = release.record_export(session, result, release.deployer_from_env())
        record.status = ReleaseStatus.PUSHED
        session.commit()
        print(f"Verified and adopted {record.content_commit}. No GitHub content was changed.")


if __name__ == "__main__":
    main()
