import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image as Pillow

from blog.exporter import export

BACKEND = {"slug": "backend", "name": "Backend"}
SERIES = {"slug": "build-a-cms", "name": "自建 CMS"}
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def draft(**overrides):
    return {"title": "Hello", "topic": BACKEND, "tags": [], "markdown": "body", **overrides}


def create(client, **overrides):
    r = client.post("/api/articles", json=draft(**overrides))
    assert r.status_code == 201, r.text
    return r.json()


def publish(client, doc_id, revision, **overrides):
    return client.post(f"/api/articles/{doc_id}/publish", json={"base_revision": revision, **draft(**overrides)})


def upload(client) -> str:
    out = io.BytesIO()
    Pillow.new("RGB", (4, 4), "red").save(out, "PNG")
    r = client.post("/api/images", files={"file": ("x.png", out.getvalue(), "image/png")})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "--quiet")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    return tmp_path


def test_a_new_draft_has_no_excerpt_cover_or_series(client):
    body = create(client)
    assert (body["excerpt"], body["cover"], body["series"]) == ("", None, None)


def test_excerpt_cover_and_series_round_trip_through_autosave(client):
    image_id = upload(client)
    doc_id = create(client)["doc_id"]
    saved = client.put(
        f"/api/articles/{doc_id}/draft",
        json={"base_revision": 1, **draft(excerpt="  Short  ", cover=image_id, series=SERIES)},
    ).json()
    assert (saved["excerpt"], saved["cover"], saved["series"]) == ("Short", image_id, SERIES)
    assert client.get(f"/api/articles/{doc_id}/draft").json()["series"] == SERIES


@pytest.mark.parametrize("overrides", [{"excerpt": "x" * 301}, {"cover": "images/a.webp"}, {"series": {"slug": "Bad Slug", "name": "x"}}])
def test_rejects_an_overlong_excerpt_a_malformed_cover_or_series(client, overrides):
    assert client.post("/api/articles", json=draft(**overrides)).status_code == 422


def test_publish_rejects_a_cover_the_article_does_not_contain(client):
    image_id = upload(client)
    doc_id = create(client)["doc_id"]
    r = publish(client, doc_id, 1, cover=image_id)
    assert r.status_code == 422
    assert "cover" in r.json()["detail"]
    assert publish(client, doc_id, 1, cover=image_id, markdown=f"![](images/{image_id})").status_code == 201


def test_pinning_is_reported_in_the_article_list_and_can_be_undone(client):
    doc_id = create(client)["doc_id"]
    assert client.put(f"/api/articles/{doc_id}/pinned", json={"pinned": True}).json()["pinned"] is True
    assert client.get("/api/articles").json()[0]["pinned"] is True
    assert client.put(f"/api/articles/{doc_id}/pinned", json={"pinned": False}).json()["pinned"] is False


def test_pinning_an_unknown_article_is_404(client):
    assert client.put("/api/articles/01K7M4Y7P65BDCF8AHRTQY7ZQA/pinned", json={"pinned": True}).status_code == 404


def test_export_leaves_out_unset_metadata(client, repo):
    doc_id = create(client)["doc_id"]
    publish(client, doc_id, 1)
    export(repo)
    article = json.loads((repo / f"articles/{doc_id}.json").read_text())
    assert not {"updated_at", "excerpt", "cover", "series", "pinned_at"} & article.keys()


def test_export_writes_metadata_and_the_update_time_of_a_republished_article(client, repo):
    image_id = upload(client)
    doc_id = create(client)["doc_id"]
    first = publish(client, doc_id, 1).json()
    md = f"![](images/{image_id})"
    second = publish(client, doc_id, 2, markdown=md, excerpt="Short", cover=image_id, series=SERIES).json()
    client.put(f"/api/articles/{doc_id}/pinned", json={"pinned": True})
    export(repo)
    article = json.loads((repo / f"articles/{doc_id}.json").read_text())

    def z(iso):
        return iso.replace("+00:00", "Z")

    assert article["published_at"] == z(first["published_at"])
    assert article["updated_at"] == z(second["published_at"])
    assert (article["excerpt"], article["cover"], article["series"]) == ("Short", f"images/{image_id}", SERIES)
    assert "pinned_at" in article

    if shutil.which("node"):
        result = subprocess.run(["node", "scripts/check-snapshot.ts", str(repo)], cwd=FRONTEND, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
