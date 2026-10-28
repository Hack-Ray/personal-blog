import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from blog import release
from blog.db import SessionLocal, engine

BACKEND = {"slug": "backend", "name": "Backend"}
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "--quiet")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    return tmp_path


def create(client) -> str:
    r = client.post("/api/articles", json={"title": "Hello", "topic": BACKEND, "markdown": "body"})
    assert r.status_code == 201, r.text
    return r.json()["doc_id"]


def published(client) -> str:
    doc_id = create(client)
    r = client.post(f"/api/articles/{doc_id}/publish", json={"base_revision": 1, "title": "Hello", "topic": BACKEND, "markdown": "body"})
    assert r.status_code == 201, r.text
    return doc_id


def set_slug(client, doc_id, slug):
    return client.put(f"/api/articles/{doc_id}/slug", json={"slug": slug})


def release_site(repo) -> dict:
    """Exports and records a release the way 「更新網站」 does, and returns the manifest."""
    with SessionLocal() as s:
        assert release.create(s, repo, None) is not None
    return json.loads((repo / "manifest.json").read_text())


def entry(manifest, doc_id):
    return next(a for a in manifest["articles"] + manifest["archived_articles"] if a["doc_id"] == doc_id)


def test_a_slug_is_shown_in_the_draft_and_the_article_list_and_can_be_cleared(client):
    doc_id = create(client)
    assert client.get(f"/api/articles/{doc_id}/draft").json()["slug"] is None
    r = set_slug(client, doc_id, "hello-world")
    assert r.status_code == 200 and r.json()["slug"] == "hello-world"
    assert client.get(f"/api/articles/{doc_id}/draft").json()["slug"] == "hello-world"
    assert client.get("/api/articles").json()[0]["slug"] == "hello-world"
    assert set_slug(client, doc_id, "hello-world").status_code == 200
    assert set_slug(client, doc_id, None).json()["slug"] is None


@pytest.mark.parametrize("slug", ["Hello", "hello_world", "-hello", "hello--world", "", "page", "a" * 81])
def test_rejects_a_malformed_or_reserved_slug(client, slug):
    doc_id = create(client)
    assert set_slug(client, doc_id, slug).status_code == 422


def test_another_articles_current_slug_is_taken_and_a_free_variant_suggested(client):
    first, second = create(client), create(client)
    assert set_slug(client, first, "hello").status_code == 200
    assert set_slug(client, second, "hello-2").status_code == 200
    third = create(client)
    r = set_slug(client, third, "hello")
    assert r.status_code == 409
    assert r.json()["suggestion"] == "hello-3"
    assert set_slug(client, first, "hello").status_code == 200


def test_a_suggestion_stays_within_the_length_limit(client):
    first, second = create(client), create(client)
    long = "a" * 79 + "b"
    set_slug(client, first, long)
    suggestion = set_slug(client, second, long).json()["suggestion"]
    assert suggestion == "a" * 78 + "-2"


def test_setting_a_slug_on_an_unknown_article_is_404(client):
    assert set_slug(client, "01K7M4Y7P65BDCF8AHRTQY7ZQA", "hello").status_code == 404


def test_an_article_first_exported_with_a_slug_gets_no_doc_id_redirect(client, repo):
    doc_id = published(client)
    set_slug(client, doc_id, "hello")
    assert entry(release_site(repo), doc_id) == {"doc_id": doc_id, "version": 1, "slug": "hello"}
    assert "slug" not in json.loads((repo / f"articles/{doc_id}.json").read_text())


def test_a_slug_added_after_the_doc_id_url_went_live_redirects_from_the_doc_id(client, repo):
    doc_id = published(client)
    assert entry(release_site(repo), doc_id) == {"doc_id": doc_id, "version": 1}
    set_slug(client, doc_id, "hello")
    assert entry(release_site(repo), doc_id) == {"doc_id": doc_id, "version": 1, "slug": "hello", "redirect_from": [doc_id]}

    if shutil.which("node"):
        result = subprocess.run(["node", "scripts/check-snapshot.ts", str(repo)], cwd=FRONTEND, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr


def test_a_slug_changed_after_export_redirects_and_stays_with_its_article(client, repo):
    doc_id, other = published(client), create(client)
    set_slug(client, doc_id, "old")
    release_site(repo)
    set_slug(client, doc_id, "new")
    assert entry(release_site(repo), doc_id)["redirect_from"] == ["old"]
    r = set_slug(client, other, "old")
    assert r.status_code == 409 and r.json()["suggestion"] == "old-2"
    assert set_slug(client, doc_id, "old").status_code == 200
    assert entry(release_site(repo), doc_id)["redirect_from"] == ["new"]


def test_a_slug_changed_before_any_export_leaves_no_redirect_and_is_free_again(client, repo):
    doc_id, other = published(client), create(client)
    set_slug(client, doc_id, "typo")
    set_slug(client, doc_id, "fixed")
    assert entry(release_site(repo), doc_id) == {"doc_id": doc_id, "version": 1, "slug": "fixed"}
    assert set_slug(client, other, "typo").status_code == 200


def test_clearing_an_exported_slug_returns_to_the_doc_id_and_redirects_the_slug(client, repo):
    doc_id = published(client)
    set_slug(client, doc_id, "hello")
    release_site(repo)
    set_slug(client, doc_id, None)
    assert entry(release_site(repo), doc_id) == {"doc_id": doc_id, "version": 1, "redirect_from": ["hello"]}


def test_archived_articles_keep_their_slug_and_redirects(client, repo):
    doc_id = published(client)
    release_site(repo)
    set_slug(client, doc_id, "hello")
    client.post(f"/api/articles/{doc_id}/archive")
    manifest = release_site(repo)
    assert manifest["archived_articles"] == [{"doc_id": doc_id, "slug": "hello", "redirect_from": [doc_id]}]


def test_purging_an_article_frees_its_slugs(client, repo):
    doc_id, other = published(client), create(client)
    set_slug(client, doc_id, "old")
    release_site(repo)
    set_slug(client, doc_id, "new")
    client.delete(f"/api/articles/{doc_id}")
    client.post(f"/api/articles/{doc_id}/purge")
    assert set_slug(client, other, "old").status_code == 200
    assert set_slug(client, other, "new").status_code == 200


def test_the_migration_records_the_doc_id_url_of_every_article_published_before_it():
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    command.downgrade(config, "0015")
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO articles (doc_id, state, first_published_at) VALUES"
                    " ('01K7M4Y7P65BDCF8AHRTQY7ZQA', 'published', now()), ('01K7M4Y7P65BDCF8AHRTQY7ZQB', 'draft', NULL)"
                )
            )
    finally:
        command.upgrade(config, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT segment FROM article_urls")).scalars().all() == ["01K7M4Y7P65BDCF8AHRTQY7ZQA"]


def test_a_slug_moved_to_another_article_during_an_export_stays_with_that_article(client, repo):
    a, b = published(client), published(client)
    set_slug(client, a, "x")
    with SessionLocal() as s:
        render = release.exporter.render_snapshot

        def moved_mid_export(session):
            files = render(session)
            assert set_slug(client, a, "y").status_code == 200
            assert set_slug(client, b, "x").status_code == 200
            return files

        release.exporter.render_snapshot = moved_mid_export
        try:
            assert release.create(s, repo, None) is not None
        finally:
            release.exporter.render_snapshot = render
    with engine.connect() as conn:
        owners = dict(conn.execute(text("SELECT u.segment, a.doc_id FROM article_urls u JOIN articles a ON a.id = u.article_id")).all())
    assert "x" not in owners
    set_slug(client, b, "z")
    manifest = release_site(repo)
    assert "x" not in entry(manifest, a).get("redirect_from", [])


@pytest.mark.parametrize("b_published", [True, False])
def test_a_slug_claimed_while_an_export_is_being_recorded_is_never_claimed_twice(client, repo, monkeypatch, b_published):
    a = published(client)
    b = published(client) if b_published else create(client)
    set_slug(client, a, "x")
    render = release.exporter.render_snapshot

    def moved_mid_export(session):
        files = render(session)
        assert set_slug(client, a, "y").status_code == 200
        return files

    with monkeypatch.context() as m, ThreadPoolExecutor(1) as pool, SessionLocal() as s:
        m.setattr(release.exporter, "render_snapshot", moved_mid_export)
        claims = []

        def claim_before_the_release_commits(_):
            claims.append(pool.submit(set_slug, client, b, "x"))
            wait(claims, timeout=1)

        release.create(s, repo, None, on_prepared=claim_before_the_release_commits)
        claimed = claims[0].result(timeout=10).status_code == 200
    if not b_published:
        client.post(f"/api/articles/{b}/publish", json={"base_revision": 1, "title": "Hello", "topic": BACKEND, "markdown": "body"})
    manifest = release_site(repo)
    claimants = [e["doc_id"] for e in manifest["articles"] if e.get("slug") == "x" or "x" in e.get("redirect_from", [])]
    assert claimants == [b if claimed else a]
