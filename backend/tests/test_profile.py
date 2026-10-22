import json
import shutil
import subprocess
from pathlib import Path

import pytest

from blog import articles
from blog.db import SessionLocal
from blog.exporter import export
from blog.models import Profile

SEED = {
    "name": "Your Name",
    "headline": "",
    "intro": "",
    "links": [],
    "experience": [],
    "projects": [],
    "site": {"title": "Personal Blog", "description": "", "footer": ""},
}
EDITED = {
    "name": "Ray",
    "headline": "Backend engineer",
    "intro": "I write **Python**.",
    "links": [{"label": "Email", "url": "mailto:me@example.com"}],
    "experience": [{"role": "Engineer", "organization": "Acme", "period": "2023", "description": "APIs"}],
    "projects": [
        {"name": "Blog", "url": "https://github.com/Hack-Ray/personal-blog", "description": "This site", "tags": ["FastAPI"]},
        {"name": "Notes", "description": "", "tags": []},
    ],
    "site": {"title": "Ray's notes", "description": "Software engineering & <backend> notes", "footer": "© Ray · CC BY 4.0"},
}
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def put(client, content, revision=1):
    return client.put("/api/profile", json={"revision": revision, "content": content})


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "--quiet")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    return tmp_path


def test_get_returns_the_seeded_profile(client):
    body = client.get("/api/profile").json()
    assert (body["revision"], body["content"]) == (1, SEED)


def test_a_row_saved_without_site_reads_as_the_default_site(client):
    # The migration seeds the row without "site"; check the stored JSON, not only the API.
    with SessionLocal() as s:
        assert "site" not in s.get_one(Profile, 1).content
    assert client.get("/api/profile").json()["content"]["site"] == SEED["site"]


def test_save_without_site_stores_the_default_site(client):
    content = {k: v for k, v in EDITED.items() if k != "site"}
    assert put(client, content).json()["content"]["site"] == SEED["site"]


def test_save_stores_the_content_and_advances_the_revision(client):
    r = put(client, EDITED)
    assert r.status_code == 200, r.text
    assert (r.json()["revision"], r.json()["content"]) == (2, EDITED)
    assert client.get("/api/profile").json()["content"] == EDITED


def test_save_strips_strings(client):
    content = {**SEED, "name": "  Ray ", "projects": [{"name": " Blog ", "description": " x ", "tags": [" go "]}]}
    saved = put(client, content).json()["content"]
    assert saved["name"] == "Ray"
    assert saved["projects"] == [{"name": "Blog", "description": "x", "tags": ["go"]}]
    site = {"title": " Notes ", "description": " About code ", "footer": " © Ray "}
    saved = put(client, {**SEED, "site": site}, revision=2).json()["content"]
    assert saved["site"] == {"title": "Notes", "description": "About code", "footer": "© Ray"}


@pytest.mark.parametrize("url", ["http://example.com", "javascript:alert(1)", "https://", "/about/", ""])
def test_urls_must_be_https_or_mailto(client, url):
    assert put(client, {**SEED, "links": [{"label": "x", "url": url}]}).status_code == 422
    project = {"name": "x", "url": url, "description": "", "tags": []}
    assert put(client, {**SEED, "projects": [project]}).status_code == 422


@pytest.mark.parametrize(
    "content",
    [
        {**SEED, "name": "   "},
        {**SEED, "links": [{"label": " ", "url": "https://example.com"}]},
        {**SEED, "experience": [{"role": "", "organization": "Acme", "period": "", "description": ""}]},
        {**SEED, "projects": [{"name": "x", "description": "", "tags": [" "]}]},
        {**SEED, "headline": "x" * 201},
        {**SEED, "site": {"title": "  ", "description": ""}},
        {**SEED, "site": {"description": "x"}},
        {**SEED, "site": {"title": "x" * 101, "description": ""}},
        {**SEED, "site": {"title": "x", "description": "x" * 301}},
        {**SEED, "site": {"title": "x", "description": "", "footer": "x" * 201}},
        {**SEED, "site": "Personal Blog"},
    ],
)
def test_rejects_blank_required_fields_and_overlong_text(client, content):
    assert put(client, content).status_code == 422
    assert client.get("/api/profile").json()["revision"] == 1


def test_save_from_a_stale_revision_is_rejected(client):
    put(client, EDITED)
    r = put(client, {**EDITED, "name": "Other"})
    assert r.status_code == 409
    assert r.json()["current_revision"] == 2
    assert client.get("/api/profile").json()["content"]["name"] == "Ray"


def test_profile_requires_sign_in(anon):
    assert anon.get("/api/profile").status_code == 401
    assert put(anon, EDITED).status_code == 401


def test_export_writes_profile_json(client, repo):
    put(client, EDITED)
    export(repo)
    exported = json.loads((repo / "profile.json").read_text())
    assert exported == EDITED
    assert list(exported) == ["name", "headline", "intro", "links", "experience", "projects", "site"]
    assert "profile.json" in git(repo, "ls-files").split()


def test_a_profile_only_change_is_new_content(client, repo):
    first = export(repo)
    assert export(repo) is None
    put(client, EDITED)
    second = export(repo)
    assert second is not None and second.release_id != first.release_id
    assert git(repo, "rev-list", "--count", "HEAD").strip() == "2"


def test_interrupted_profile_write_is_discarded(client, repo):
    export(repo)
    (repo / "profile.json").write_text("{}")
    assert export(repo) is None
    assert json.loads((repo / "profile.json").read_text()) == SEED


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the frontend snapshot parser")
def test_frontend_parses_the_exported_profile_and_falls_back_to_the_seed(client, repo):
    with SessionLocal() as s:
        doc_id = articles.create_article(s, articles.DraftContent("T", articles.Taxon("backend", "Backend"), "m")).article.doc_id
        articles.publish(s, doc_id, 1, articles.DraftContent("T", articles.Taxon("backend", "Backend"), "m"))
    put(client, EDITED)
    export(repo)

    def parsed():
        r = subprocess.run(
            ["node", "scripts/check-snapshot.ts", str(repo), "--profile"], cwd=FRONTEND, capture_output=True, text=True
        )
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout.splitlines()[1])

    assert parsed() == EDITED
    (repo / "profile.json").unlink()
    assert parsed() == SEED
