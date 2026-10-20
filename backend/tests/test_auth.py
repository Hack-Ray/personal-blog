from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from blog import auth
from blog.db import SessionLocal, engine
from blog.models import AdminSession
from tests.conftest import ADMIN_PASSWORD

ARTICLE = {"title": "T", "topic": {"slug": "backend", "name": "Backend"}, "markdown": "m"}


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/articles"),
        ("POST", "/api/articles"),
        ("GET", "/api/articles/01K7M4Y7P65BDCF8AHRTQY7ZQF/draft"),
        ("POST", "/api/images"),
        ("GET", "/api/images/x.png"),
    ],
)
def test_api_requires_sign_in(anon, method, path):
    r = anon.request(method, path)
    assert r.status_code == 401


def test_session_status_and_sign_in_are_public(anon):
    assert anon.get("/api/session").json() == {"signed_in": False}
    assert anon.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204
    assert anon.get("/api/session").json() == {"signed_in": True}
    assert anon.post("/api/articles", json=ARTICLE).status_code == 201


def test_session_cookie_is_httponly_and_strict(anon):
    r = anon.post("/api/session", json={"password": ADMIN_PASSWORD})
    cookie = r.headers["set-cookie"].lower()
    assert "cms_session=" in cookie
    assert "httponly" in cookie
    assert "samesite=strict" in cookie


def test_only_a_hash_of_the_session_token_is_stored(anon):
    anon.post("/api/session", json={"password": ADMIN_PASSWORD})
    token = anon.cookies[auth.SESSION_COOKIE]
    with SessionLocal() as s:
        stored = s.scalars(text("SELECT token_hash FROM admin_sessions")).all()
    assert token not in stored
    assert len(stored) == 1 and len(stored[0]) == 64


def test_wrong_password_is_rejected(anon):
    r = anon.post("/api/session", json={"password": "not the password"})
    assert r.status_code == 401
    assert auth.SESSION_COOKIE not in anon.cookies


def test_five_failures_lock_sign_in_even_for_the_right_password(anon):
    for _ in range(auth.MAX_FAILURES):
        assert anon.post("/api/session", json={"password": "wrong"}).status_code == 401
    assert anon.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 429


def test_sign_out_ends_the_session(client):
    assert client.delete("/api/session").status_code == 204
    assert client.get("/api/articles").status_code == 401


def test_expired_session_is_refused(client):
    with engine.begin() as conn:
        conn.execute(text("UPDATE admin_sessions SET expires_at = now() - interval '1 second'"))
    assert client.get("/api/articles").status_code == 401


def test_setting_a_new_password_signs_everyone_out(client):
    with SessionLocal() as s:
        auth.set_password(s, "a brand new long password")
    assert client.get("/api/articles").status_code == 401
    assert client.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 401
    assert client.post("/api/session", json={"password": "a brand new long password"}).status_code == 204


def test_short_passwords_are_refused():
    with SessionLocal() as s, pytest.raises(ValueError, match="at least 12"):
        auth.set_password(s, "short")


def test_no_admin_means_nobody_can_sign_in(anon):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM admin_credentials"))
    assert anon.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 401


def test_cross_origin_writes_are_refused_even_when_signed_in(client):
    r = client.post("/api/articles", json=ARTICLE, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    same = client.post("/api/articles", json=ARTICLE, headers={"origin": "http://testserver"})
    assert same.status_code == 201


def test_password_hash_is_salted_scrypt():
    a, b = auth.hash_password(ADMIN_PASSWORD), auth.hash_password(ADMIN_PASSWORD)
    assert a != b and a.startswith("scrypt$")
    assert auth.verify_password(ADMIN_PASSWORD, a) and not auth.verify_password("nope", a)


def test_signing_in_prunes_expired_sessions(anon):
    with SessionLocal() as s:
        s.add(AdminSession(token_hash="0" * 64, expires_at=datetime(2000, 1, 1, tzinfo=UTC)))
        s.commit()
    anon.post("/api/session", json={"password": ADMIN_PASSWORD})
    with SessionLocal() as s:
        assert s.get(AdminSession, "0" * 64) is None
