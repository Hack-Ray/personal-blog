from sqlalchemy import text

from blog import articles
from blog.db import engine

BACKEND = {"slug": "backend", "name": "Backend"}


def draft(markdown, **overrides):
    return {"title": "T", "topic": BACKEND, "tags": [], "markdown": markdown, **overrides}


class Editor:
    """Saves the way the CMS does: each save carries the last revision."""

    def __init__(self, client, markdown="v0"):
        self.client = client
        body = client.post("/api/articles", json=draft(markdown)).json()
        self.doc_id, self.revision = body["doc_id"], body["revision"]

    def save(self, markdown):
        r = self.client.put(f"/api/articles/{self.doc_id}/draft", json=draft(markdown, base_revision=self.revision))
        assert r.status_code == 200, r.text
        self.revision = r.json()["revision"]

    def snapshots(self):
        return [s["markdown"] for s in self.client.get(f"/api/articles/{self.doc_id}/snapshots").json()]


def age_snapshots(minutes):
    with engine.begin() as conn:
        conn.execute(text("UPDATE draft_snapshots SET created_at = created_at - make_interval(mins => :m)"), {"m": minutes})


def test_first_save_keeps_the_content_it_replaces(client):
    e = Editor(client, "original")
    e.save("original plus typing")
    assert e.snapshots() == ["original"]


def test_small_edits_within_10_minutes_add_no_snapshot(client):
    e = Editor(client, "a")
    for text_ in ["ab", "abc", "abcd"]:
        e.save(text_)
    assert e.snapshots() == ["a"]


def test_a_snapshot_is_taken_again_after_10_minutes(client):
    e = Editor(client, "a")
    e.save("ab")
    age_snapshots(11)
    e.save("abc")
    assert e.snapshots() == ["ab", "a"]


def test_a_large_change_is_snapshotted_immediately(client):
    long = "x" * 600
    e = Editor(client, "a")
    e.save(long)
    e.save("oops, deleted everything")
    assert e.snapshots() == [long, "a"]


def test_unchanged_or_empty_content_is_not_snapshotted(client):
    e = Editor(client, "")
    e.save("first words")
    assert e.snapshots() == []


def test_only_the_latest_50_snapshots_are_kept(client):
    e = Editor(client, "start")
    for i in range(articles.SNAPSHOT_LIMIT + 5):
        e.save(f"{i:03d}" + "y" * 600 * (i % 2))
    snaps = e.snapshots()
    assert len(snaps) == articles.SNAPSHOT_LIMIT
    assert "start" not in snaps


def test_publishing_clears_the_snapshots(client):
    e = Editor(client, "a")
    e.save("ab")
    r = client.post(f"/api/articles/{e.doc_id}/publish", json=draft("ab", base_revision=e.revision))
    assert r.status_code == 201
    assert e.snapshots() == []


def test_restore_writes_the_snapshot_back_and_can_be_undone(client):
    e = Editor(client, "good paragraph")
    e.save("accidentally replaced")
    snapshot_id = client.get(f"/api/articles/{e.doc_id}/snapshots").json()[0]["id"]
    age_snapshots(11)

    r = client.post(
        f"/api/articles/{e.doc_id}/snapshots/{snapshot_id}/restore", json={"base_revision": e.revision}
    )

    assert r.status_code == 200
    assert r.json()["markdown"] == "good paragraph"
    assert r.json()["revision"] == e.revision + 1
    assert e.snapshots() == ["accidentally replaced", "good paragraph"]


def test_restore_with_a_stale_revision_is_rejected(client):
    e = Editor(client, "a")
    e.save("ab")
    snapshot_id = client.get(f"/api/articles/{e.doc_id}/snapshots").json()[0]["id"]
    r = client.post(f"/api/articles/{e.doc_id}/snapshots/{snapshot_id}/restore", json={"base_revision": 1})
    assert r.status_code == 409


def test_snapshot_of_another_article_is_not_found(client):
    a, b = Editor(client, "a"), Editor(client, "b")
    a.save("a2")
    snapshot_id = client.get(f"/api/articles/{a.doc_id}/snapshots").json()[0]["id"]
    r = client.post(f"/api/articles/{b.doc_id}/snapshots/{snapshot_id}/restore", json={"base_revision": b.revision})
    assert r.status_code == 404
