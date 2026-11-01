"""A fake GitHub Git Data API backed by a local bare repository, and a
helper that releases the CMS's content into it the way 「更新網站」 does."""

import base64
import json
import os
import subprocess
from urllib.parse import unquote, urlsplit

from blog import release
from blog.content_repository import GitHubRepository
from blog.db import SessionLocal
from blog.github import GitHubError


class LocalGitAPI:
    api_url = "https://github.test"

    def __init__(self, path):
        self.path = path
        self.calls = []
        self.truncated = False
        self.lose_patch_response = False
        self.fail_patch = False
        self.env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Test",
            "GIT_AUTHOR_EMAIL": "test@example.com",
            "GIT_COMMITTER_NAME": "Test",
            "GIT_COMMITTER_EMAIL": "test@example.com",
            "GIT_INDEX_FILE": str(path.parent / "git-api-index"),
        }
        subprocess.run(["git", "init", "--bare", "--quiet", str(path)], check=True)
        readme = self.git("hash-object", "-w", "--stdin", data=b"keep me\n")
        self.git("update-index", "--add", "--cacheinfo", f"100644,{readme},README.md")
        tree = self.git("write-tree")
        initial = self.git("commit-tree", tree, "-m", "Initialize")
        self.git("update-ref", "refs/heads/main", initial)

    def git(self, *args, data=None):
        return (
            subprocess.run(
                ["git", "--git-dir", str(self.path), *args],
                input=data,
                check=True,
                capture_output=True,
                env=self.env,
            )
            .stdout.decode()
            .strip()
        )

    def head(self):
        return self.git("rev-parse", "refs/heads/main")

    def files(self, commit):
        return self.git("ls-tree", "-r", "--name-only", commit).splitlines()

    def contents(self, commit, path):
        return self.git("show", f"{commit}:{path}")

    def call(self, method, path, body=None):
        self.calls.append((method, path, body))
        suffix = unquote(urlsplit(path).path.split("/git/", 1)[1])
        if method == "GET" and suffix.startswith("ref/heads/"):
            if suffix != "ref/heads/main":
                raise GitHubError("not found", status=404)
            return {"object": {"sha": self.head()}}
        if method == "GET" and suffix.startswith("commits/"):
            commit = suffix.removeprefix("commits/")
            return {"tree": {"sha": self.git("rev-parse", f"{commit}^{{tree}}")}}
        if method == "GET" and suffix.startswith("trees/"):
            entries = []
            for line in self.git("ls-tree", "-r", suffix.removeprefix("trees/")).splitlines():
                meta, name = line.split("\t")
                mode, kind, sha = meta.split()
                entries.append({"path": name, "mode": mode, "type": kind, "sha": sha})
            return {"tree": entries, "truncated": self.truncated}
        if method == "GET" and suffix.startswith("blobs/"):
            data = subprocess.run(
                ["git", "--git-dir", str(self.path), "cat-file", "blob", suffix.removeprefix("blobs/")],
                check=True,
                capture_output=True,
            ).stdout
            return {"encoding": "base64", "content": base64.b64encode(data).decode()}
        if method == "POST" and suffix == "blobs":
            return {"sha": self.git("hash-object", "-w", "--stdin", data=base64.b64decode(body["content"]))}
        if method == "POST" and suffix == "trees":
            self.git("read-tree", body["base_tree"])
            for entry in body["tree"]:
                if entry["sha"] is None:
                    self.git("update-index", "--index-info", data=f"0 {'0' * 40}\t{entry['path']}\n".encode())
                else:
                    self.git("update-index", "--add", "--cacheinfo", f"{entry['mode']},{entry['sha']},{entry['path']}")
            return {"sha": self.git("write-tree")}
        if method == "POST" and suffix == "commits":
            assert len(body["parents"]) == 1
            return {"sha": self.git("commit-tree", body["tree"], "-p", body["parents"][0], "-m", body["message"])}
        if method == "PATCH" and suffix == "refs/heads/main":
            assert body["force"] is False
            if self.fail_patch:
                raise GitHubError("GitHub API PATCH returned 500", status=500)
            previous = self.head()
            if subprocess.run(
                ["git", "--git-dir", str(self.path), "merge-base", "--is-ancestor", previous, body["sha"]],
                capture_output=True,
            ).returncode:
                raise GitHubError("not a fast-forward", status=422)
            self.git("update-ref", "refs/heads/main", body["sha"], previous)
            if self.lose_patch_response:
                self.lose_patch_response = False
                raise GitHubError("response lost")
            return {}
        raise AssertionError((method, path, body))


class Content:
    """A content repository behind LocalGitAPI."""

    def __init__(self, path):
        self.api = LocalGitAPI(path)
        self.repo = GitHubRepository(self.api, "owner/content", "main")

    def release(self, deployer=None):
        """Exports and pushes the published content; None when nothing changed."""
        with SessionLocal() as session:
            return release.create(session, self.repo, deployer)

    def read(self, path):
        return self.api.contents(self.api.head(), path)

    def read_bytes(self, path):
        return subprocess.run(["git", "--git-dir", str(self.api.path), "show", f"{self.api.head()}:{path}"], check=True, capture_output=True).stdout

    def images(self):
        return sorted(f.removeprefix("images/") for f in self.files() if f.startswith("images/"))

    def json(self, path):
        return json.loads(self.read(path))

    def files(self):
        return self.api.files(self.api.head())

    def checkout(self, dest):
        """Writes the HEAD tree into `dest`, for tools that read a Snapshot folder."""
        dest.mkdir(parents=True, exist_ok=True)
        archive = subprocess.run(["git", "--git-dir", str(self.api.path), "archive", self.api.head()], check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", str(dest)], input=archive, check=True)
        return dest
