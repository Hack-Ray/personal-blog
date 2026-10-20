import hashlib
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from blog import images
from blog.api import app
from blog.db import SessionLocal, engine
from blog.exporter import ExportError, export

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x01" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x02" * 32
BACKEND = {"slug": "backend", "name": "Backend"}
FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def upload(client, data, name="x.png"):
    return client.post("/api/images", files={"file": (name, data, "application/octet-stream")})


def draft(markdown, **overrides):
    return {"title": "T", "topic": BACKEND, "tags": [], "markdown": markdown, **overrides}


def set_unreferenced_since(image_id, days_ago):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE images SET unreferenced_since = now() - make_interval(days => :d) WHERE id = :id"),
            {"d": days_ago, "id": image_id},
        )


def gc(days_from_now=0):
    with SessionLocal() as s:
        return images.collect_garbage(s, datetime.now(UTC) + timedelta(days=days_from_now))


def exists(image_id):
    with SessionLocal() as s:
        return images.load(s, image_id) is not None


@pytest.mark.parametrize(("data", "ext", "content_type"), [(PNG, "png", "image/png"), (JPEG, "jpg", "image/jpeg"), (WEBP, "webp", "image/webp")])
def test_upload_names_the_image_by_its_content_hash(client, data, ext, content_type):
    r = upload(client, data, name="whatever.gif")
    assert r.status_code == 201
    image_id = f"{hashlib.sha256(data).hexdigest()}.{ext}"
    assert r.json() == {"id": image_id, "markdown": f"![](images/{image_id})"}
    served = client.get(f"/api/images/{image_id}")
    assert (served.content, served.headers["content-type"]) == (data, content_type)


def test_uploading_the_same_bytes_twice_returns_the_same_image(client):
    assert upload(client, PNG).json() == upload(client, PNG).json()


def test_upload_rejects_non_images_and_svg(client):
    assert upload(client, b"<svg xmlns='http://www.w3.org/2000/svg'/>", "a.svg").status_code == 415
    assert upload(client, b"hello", "a.png").status_code == 415


def test_upload_rejects_images_over_10_mb(client):
    assert upload(client, PNG + b"\x00" * images.MAX_BYTES).status_code == 413


def test_image_bytes_are_immutable(client):
    upload(client, PNG)
    with pytest.raises(DBAPIError, match="image_data rows are immutable"):
        with engine.begin() as conn:
            conn.execute(text("UPDATE image_data SET data = 'x'"))


def test_never_referenced_upload_is_kept_for_7_days(client):
    image_id = upload(client, PNG).json()["id"]
    assert gc(days_from_now=6) == []
    assert gc(days_from_now=8) == [image_id]
    assert not exists(image_id)


def test_image_referenced_by_a_draft_is_kept(client):
    ref = upload(client, PNG).json()
    set_unreferenced_since(ref["id"], 30)
    client.post("/api/articles", json=draft(ref["markdown"]))
    assert gc() == []
    assert gc(days_from_now=30) == []
    assert exists(ref["id"])


def test_grace_period_starts_when_the_last_reference_goes_away(client):
    ref = upload(client, PNG).json()
    set_unreferenced_since(ref["id"], 30)
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.put(f"/api/articles/{doc_id}/draft", json=draft("no image", base_revision=1))
    # Publishing ends the editing cycle and drops the snapshot that still had the image.
    client.post(f"/api/articles/{doc_id}/publish", json=draft("no image", base_revision=2))

    assert gc() == []
    assert gc(days_from_now=6) == []
    assert gc(days_from_now=8) == [ref["id"]]


def test_image_kept_while_a_draft_snapshot_references_it(client):
    ref = upload(client, PNG).json()
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.put(f"/api/articles/{doc_id}/draft", json=draft("image removed", base_revision=1))
    assert [s["markdown"] for s in client.get(f"/api/articles/{doc_id}/snapshots").json()] == [ref["markdown"]]
    assert gc() == []
    assert gc(days_from_now=30) == []
    assert exists(ref["id"])


def test_image_kept_while_a_published_version_references_it(client):
    ref = upload(client, PNG).json()
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(ref["markdown"], base_revision=1))
    client.put(f"/api/articles/{doc_id}/draft", json=draft("image removed from draft", base_revision=2))
    assert gc() == []
    assert gc(days_from_now=30) == []
    assert exists(ref["id"])


def test_pending_deletion_keeps_images_until_purge(client):
    ref = upload(client, PNG).json()
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.delete(f"/api/articles/{doc_id}")
    assert gc() == []
    assert gc(days_from_now=29) == []

    client.post(f"/api/articles/{doc_id}/purge")
    assert gc() == []
    assert gc(days_from_now=8) == [ref["id"]]


def test_cms_startup_collects_garbage(client):
    image_id = upload(client, PNG).json()["id"]
    set_unreferenced_since(image_id, 8)
    with TestClient(app):
        pass
    assert not exists(image_id)


def _repo(tmp_path):
    subprocess.run(["git", "init", "--quiet", str(tmp_path)], check=True)
    for key, value in (("user.email", "t@example.com"), ("user.name", "T")):
        subprocess.run(["git", "-C", str(tmp_path), "config", key, value], check=True)
    return tmp_path


def test_export_includes_only_images_of_published_versions(client, tmp_path):
    repo = _repo(tmp_path)
    used, draft_only = upload(client, PNG).json(), upload(client, JPEG).json()
    doc_id = client.post("/api/articles", json=draft(used["markdown"])).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(used["markdown"], base_revision=1))
    client.put(f"/api/articles/{doc_id}/draft", json=draft(draft_only["markdown"], base_revision=2))

    export(repo)

    assert sorted(p.name for p in (repo / "images").iterdir()) == [used["id"]]
    assert (repo / "images" / used["id"]).read_bytes() == PNG


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the frontend snapshot parser")
def test_frontend_parser_accepts_exported_images(client, tmp_path):
    repo = _repo(tmp_path)
    ref = upload(client, PNG).json()
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(f"text\n\n{ref['markdown']}", base_revision=1))

    export(repo)

    result = subprocess.run(["node", "scripts/check-snapshot.ts", str(repo)], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_export_fails_without_writing_when_an_image_is_missing(client, tmp_path):
    repo = _repo(tmp_path)
    missing = f"{'0' * 64}.png"
    doc_id = client.post("/api/articles", json=draft("x")).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(f"![](images/{missing})", base_revision=1))

    with pytest.raises(ExportError, match=missing):
        export(repo)
    assert not (repo / "manifest.json").exists()
