import pytest

SEED = {
    "name": "Hack-Ray",
    "headline": "",
    "intro": "",
    "links": [{"label": "GitHub", "url": "https://github.com/Hack-Ray"}],
    "experience": [],
    "projects": [],
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
}


def put(client, content, revision=1):
    return client.put("/api/profile", json={"revision": revision, "content": content})


def test_get_returns_the_seeded_profile(client):
    body = client.get("/api/profile").json()
    assert (body["revision"], body["content"]) == (1, SEED)


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
