import threading
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from blog import auth, config
from blog.api import app
from blog.db import SessionLocal, engine
from blog.models import AdminSession, SignInAttempt
from tests.conftest import ADMIN_PASSWORD, BASE_URL

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
    token = anon.cookies[config.settings.session_cookie]
    with SessionLocal() as s:
        stored = s.scalars(text("SELECT token_hash FROM admin_sessions")).all()
    assert token not in stored
    assert len(stored) == 1 and len(stored[0]) == 64


def test_wrong_password_is_rejected(anon):
    r = anon.post("/api/session", json={"password": "not the password"})
    assert r.status_code == 401
    assert config.settings.session_cookie not in anon.cookies


def from_address(host):
    return TestClient(app, base_url=BASE_URL, client=(host, 50000))


def test_five_failures_make_that_client_wait_even_for_the_right_password(anon):
    for _ in range(auth.MAX_FAILURES):
        assert anon.post("/api/session", json={"password": "wrong"}).status_code == 401
    r = anon.post("/api/session", json={"password": ADMIN_PASSWORD})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) == auth.BACKOFF.total_seconds()


def test_failures_from_one_address_do_not_lock_out_another(anon):
    attacker = from_address("203.0.113.9")
    for _ in range(auth.MAX_FAILURES + 1):
        attacker.post("/api/session", json={"password": "wrong"})
    assert from_address("198.51.100.7").post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204


def test_each_further_failure_doubles_the_wait(anon):
    def blocked_for():
        with SessionLocal() as s:
            a = s.get_one(SignInAttempt, "testclient")
            return a.blocked_until - a.last_attempt_at

    for _ in range(auth.MAX_FAILURES):
        anon.post("/api/session", json={"password": "wrong"})
    assert blocked_for() == auth.BACKOFF
    with engine.begin() as conn:
        conn.execute(text("UPDATE sign_in_attempts SET blocked_until = now() - interval '1 second'"))
    assert anon.post("/api/session", json={"password": "wrong"}).status_code == 401
    assert blocked_for() == auth.BACKOFF * 2


def test_concurrent_guesses_cannot_exceed_the_limit(anon):
    codes = []
    barrier = threading.Barrier(12)

    def guess():
        barrier.wait()
        codes.append(from_address("203.0.113.9").post("/api/session", json={"password": "wrong"}).status_code)

    threads = [threading.Thread(target=guess) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [401] * auth.MAX_FAILURES + [429] * (12 - auth.MAX_FAILURES)


def test_a_successful_sign_in_clears_the_failures(anon):
    for _ in range(auth.MAX_FAILURES - 1):
        anon.post("/api/session", json={"password": "wrong"})
    assert anon.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204
    with SessionLocal() as s:
        assert s.get(SignInAttempt, "testclient") is None


def test_overlong_passwords_are_refused_before_hashing(anon):
    r = anon.post("/api/session", json={"password": "x" * (auth.MAX_PASSWORD_LENGTH + 1)})
    assert r.status_code == 422


def test_sign_out_ends_the_session(client):
    assert client.delete("/api/session").status_code == 204
    assert client.get("/api/articles").status_code == 401


def test_idle_session_is_refused(client):
    with engine.begin() as conn:
        conn.execute(text("UPDATE admin_sessions SET last_seen_at = now() - :idle"), {"idle": auth.IDLE_TIMEOUT})
    assert client.get("/api/articles").status_code == 401


def test_use_keeps_a_session_alive(client):
    with engine.begin() as conn:
        conn.execute(text("UPDATE admin_sessions SET last_seen_at = now() - :t"), {"t": auth.IDLE_TIMEOUT - timedelta(minutes=1)})
    assert client.get("/api/articles").status_code == 200
    with SessionLocal() as s:
        seen = s.scalars(select(AdminSession.last_seen_at)).one()
    assert seen > datetime.now(UTC) - timedelta(minutes=1)


def test_signing_out_everywhere_ends_every_session(client, anon):
    sign_in_again = from_address("198.51.100.7")
    assert sign_in_again.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204
    assert client.delete("/api/sessions").status_code == 204
    assert client.get("/api/articles").status_code == 401
    assert sign_in_again.get("/api/articles").status_code == 401


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
    same = client.post("/api/articles", json=ARTICLE, headers={"origin": BASE_URL})
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


@pytest.mark.parametrize("host", ["127.0.0.1:8000", "localhost:5173"])
def test_local_hosts_are_served(anon, host):
    assert anon.get("/api/session", headers={"host": host}).status_code == 200


def test_other_hosts_are_refused_before_sign_in(anon):
    """A page that rebinds its domain to 127.0.0.1 sends that domain as Host."""
    for _ in range(auth.MAX_FAILURES):
        r = anon.post("/api/session", json={"password": "guess"}, headers={"host": "rebind.example:8000"})
        assert r.status_code == 400
    with SessionLocal() as s:
        assert s.query(SignInAttempt).count() == 0
    assert anon.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204


@pytest.mark.parametrize("path", ["/api/session", "/api/articles"])
def test_cms_responses_carry_security_headers(anon, path):
    headers = anon.get(path).headers
    assert "script-src 'self'" in headers["content-security-policy"]
    assert "frame-ancestors 'none'" in headers["content-security-policy"]
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "same-origin"


def test_sign_in_attempts_and_changes_are_logged(anon, caplog):
    anon.post("/api/session", json={"password": "wrong password!!"})
    anon.post("/api/session", json={"password": ADMIN_PASSWORD})
    anon.get("/api/articles")
    lines = [r.getMessage() for r in caplog.records if r.name == "blog.audit"]
    assert lines == [
        "method=POST path=/api/session status=401 client=testclient",
        "method=POST path=/api/session status=204 client=testclient",
    ]
