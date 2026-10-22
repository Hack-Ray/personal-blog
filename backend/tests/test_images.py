import hashlib
import io
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image as Pillow
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from blog import images
from blog.api import app
from blog.db import SessionLocal, engine
from blog.exporter import ExportError, export
from tests.conftest import BASE_URL, sign_in



def encode(fmt, size=(8, 4), color="red", **save):
    out = io.BytesIO()
    Pillow.new("RGB", size, color).save(out, fmt, **save)
    return out.getvalue()


def animated_gif(size):
    out = io.BytesIO()
    first, second = Pillow.new("RGB", size, "red"), Pillow.new("RGB", size, "blue")
    first.save(out, "GIF", save_all=True, append_images=[second], duration=[50, 70], loop=0)
    return out.getvalue()


def opened(client, image_id):
    return Pillow.open(io.BytesIO(client.get(f"/api/images/{image_id}").content))


PNG, JPEG, WEBP = encode("PNG"), encode("JPEG"), encode("WEBP", color="blue")
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


@pytest.mark.parametrize("data", [PNG, JPEG, WEBP, encode("GIF")])
def test_upload_is_stored_as_webp_named_by_its_content_hash(client, data):
    r = upload(client, data, name="whatever.gif")
    assert r.status_code == 201
    served = client.get(f"/api/images/{r.json()['id']}")
    assert served.headers["content-type"] == "image/webp"
    assert served.content[:4] == b"RIFF" and served.content[8:12] == b"WEBP"
    image_id = f"{hashlib.sha256(served.content).hexdigest()}.webp"
    assert r.json() == {"id": image_id, "markdown": f"![](images/{image_id})"}


def test_wide_image_shrinks_to_max_width_keeping_its_ratio(client):
    image_id = upload(client, encode("PNG", size=(2560, 1316))).json()["id"]
    assert opened(client, image_id).size == (1440, 740)


def test_narrow_image_is_not_enlarged(client):
    image_id = upload(client, encode("PNG", size=(300, 200))).json()["id"]
    assert opened(client, image_id).size == (300, 200)


def test_animated_gif_stays_animated(client):
    image_id = upload(client, animated_gif((2000, 100))).json()["id"]
    im = opened(client, image_id)
    assert (im.is_animated, im.n_frames, im.size) == (True, 2, (1440, 72))


def test_transparency_is_kept(client):
    out = io.BytesIO()
    Pillow.new("RGBA", (4, 4), (0, 0, 0, 0)).save(out, "PNG")
    image_id = upload(client, out.getvalue()).json()["id"]
    assert opened(client, image_id).convert("RGBA").getpixel((0, 0))[3] == 0


def test_exif_is_dropped_and_orientation_applied(client):
    exif = Pillow.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display
    exif[0x010F] = "Camera Maker"
    image_id = upload(client, encode("JPEG", size=(40, 20), exif=exif)).json()["id"]
    im = opened(client, image_id)
    assert im.size == (20, 40)
    assert not im.getexif()


def test_unreadable_image_with_a_valid_signature_is_rejected(client):
    assert upload(client, PNG[:20]).status_code == 415


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


def profile_with_intro(client, intro):
    content = {**client.get("/api/profile").json()["content"], "intro": intro}
    r = client.put("/api/profile", json={"revision": client.get("/api/profile").json()["revision"], "content": content})
    assert r.status_code == 200, r.text


def test_image_kept_while_the_profile_intro_references_it(client):
    ref = upload(client, PNG).json()
    set_unreferenced_since(ref["id"], 30)
    profile_with_intro(client, ref["markdown"])
    assert gc(days_from_now=30) == []
    profile_with_intro(client, "no image")
    assert gc() == []
    assert gc(days_from_now=8) == [ref["id"]]


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
    with sign_in(TestClient(app, base_url=BASE_URL)):
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
    assert (repo / "images" / used["id"]).read_bytes() == client.get(f"/api/images/{used['id']}").content


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed to run the frontend snapshot parser")
def test_frontend_parser_accepts_exported_images(client, tmp_path):
    repo = _repo(tmp_path)
    ref = upload(client, PNG).json()
    doc_id = client.post("/api/articles", json=draft(ref["markdown"])).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(f"text\n\n{ref['markdown']}", base_revision=1))

    export(repo)

    result = subprocess.run(["node", "scripts/check-snapshot.ts", str(repo)], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_export_includes_images_of_the_profile_intro(client, tmp_path):
    repo = _repo(tmp_path)
    ref = upload(client, PNG).json()
    profile_with_intro(client, f"hello\n\n{ref['markdown']}")

    export(repo)

    assert sorted(p.name for p in (repo / "images").iterdir()) == [ref["id"]]


def test_export_fails_without_writing_when_an_image_is_missing(client, tmp_path):
    # Publishing checks the images exist, so remove one behind its back.
    repo = _repo(tmp_path)
    missing = upload(client, PNG).json()["id"]
    doc_id = client.post("/api/articles", json=draft("x")).json()["doc_id"]
    client.post(f"/api/articles/{doc_id}/publish", json=draft(f"![](images/{missing})", base_revision=1))
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM image_data WHERE image_id = :id"), {"id": missing})
        conn.execute(text("DELETE FROM images WHERE id = :id"), {"id": missing})

    with pytest.raises(ExportError, match=missing):
        export(repo)
    assert not (repo / "manifest.json").exists()


def test_publishing_an_article_whose_image_is_missing_is_rejected(client):
    image_id = upload(client, PNG).json()["id"]
    doc_id = client.post("/api/articles", json=draft("x")).json()["doc_id"]
    body = f"![a](images/{image_id}) ![b](images/{'0' * 64}.webp)"
    r = client.post(f"/api/articles/{doc_id}/publish", json={"base_revision": 1, **draft(body)})
    assert r.status_code == 422
    assert f"{'0' * 64}.webp" in r.text and image_id not in r.text
    ok = client.post(f"/api/articles/{doc_id}/publish", json={"base_revision": 1, **draft(f"![a](images/{image_id})")})
    assert ok.status_code == 201
