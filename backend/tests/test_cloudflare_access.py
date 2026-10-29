import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from blog import cloudflare_access, config
from blog.api import app
from tests.conftest import ADMIN_PASSWORD, BASE_URL

TEAM = "myteam.cloudflareaccess.com"
AUD = "a" * 64
ARTICLE = {"title": "T", "topic": {"slug": "backend", "name": "Backend"}, "markdown": "m"}
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_PEM = KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
JWKS = {"keys": [{**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key())), "kid": "k1", "alg": "RS256", "use": "sig"}]}


def claims(**overrides):
    now = int(time.time())
    base = {"aud": [AUD], "iss": f"https://{TEAM}", "email": "Author@Example.com", "sub": "u1", "iat": now, "exp": now + 3600}
    return {k: v for k, v in (base | overrides).items() if v is not None}


def token(key=KEY, **overrides):
    return jwt.encode(claims(**overrides), key, algorithm="RS256", headers={"kid": "k1"})


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def hs256_with_public_key():
    signing_input = f"{_b64(json.dumps({'alg': 'HS256', 'kid': 'k1'}).encode())}.{_b64(json.dumps(claims()).encode())}"
    return f"{signing_input}.{_b64(hmac.new(PUBLIC_PEM, signing_input.encode(), hashlib.sha256).digest())}"


@pytest.fixture
def keys_fetched(monkeypatch):
    fetches = []

    def fetch(_client):
        fetches.append(1)
        return JWKS

    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", fetch)
    cloudflare_access._keys.cache_clear()
    yield fetches
    cloudflare_access._keys.cache_clear()


@pytest.fixture
def behind_access(configure, keys_fetched):
    configure(access=config.CloudflareAccess(team_domain=TEAM, audience=AUD, emails=frozenset({"author@example.com"})))


def as_author(value=None):
    return TestClient(app, base_url=BASE_URL, headers={cloudflare_access.HEADER: value or token()})


@pytest.mark.parametrize("path", ["/admin/", "/", "/api/articles", "/api/session"])
def test_without_the_access_token_nothing_but_healthz_answers(behind_access, path):
    r = TestClient(app, base_url=BASE_URL).get(path)
    assert r.status_code == 403
    assert r.json() == {"detail": "Cloudflare Access sign-in required"}


def test_healthz_needs_no_token(behind_access):
    assert TestClient(app, base_url=BASE_URL).get("/healthz").status_code == 200


def test_a_valid_token_signs_in_without_any_cookie(behind_access):
    c = as_author()
    assert c.get("/api/session").json() == {"signed_in": True, "method": "cloudflare"}
    assert c.post("/api/articles", json=ARTICLE).status_code == 201
    assert c.get("/api/articles").status_code == 200
    assert not c.cookies


def test_signing_keys_are_fetched_once_and_reused(behind_access, keys_fetched):
    c = as_author()
    for _ in range(3):
        assert c.get("/api/articles").status_code == 200
    assert len(keys_fetched) == 1


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(lambda: token(aud=["b" * 64]), id="wrong audience"),
        pytest.param(lambda: token(iss="https://other.cloudflareaccess.com"), id="wrong issuer"),
        pytest.param(lambda: token(exp=int(time.time()) - 3600), id="expired"),
        pytest.param(lambda: token(iat=int(time.time()) + 3600), id="issued in the future"),
        pytest.param(lambda: token(exp=None), id="no expiry"),
        pytest.param(lambda: token(email="someone@example.com"), id="email not allowed"),
        pytest.param(lambda: token(email=None), id="no email"),
        pytest.param(lambda: token(key=OTHER_KEY), id="signed with another key"),
        pytest.param(hs256_with_public_key, id="HS256 with the public key as secret"),
        pytest.param(lambda: jwt.encode(claims(), None, algorithm="none"), id="alg none"),
        pytest.param(lambda: "not.a.token", id="garbage"),
    ],
)
def test_invalid_tokens_are_refused(behind_access, bad):
    r = as_author(bad()).get("/api/articles")
    assert r.status_code == 403
    assert r.json() == {"detail": "Cloudflare Access sign-in required"}


def test_a_little_clock_skew_is_tolerated(behind_access):
    assert as_author(token(iat=int(time.time()) + 30)).get("/api/articles").status_code == 200


def test_unreachable_signing_keys_answer_503_and_are_logged(behind_access, monkeypatch, caplog):
    def down(_client):
        raise jwt.PyJWKClientConnectionError("connection refused")

    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", down)
    r = as_author().get("/api/articles")
    assert r.status_code == 503
    assert any("Cloudflare Access signing keys" in rec.getMessage() for rec in caplog.records if rec.levelname == "ERROR")


def test_a_password_session_cookie_does_not_sign_in(admin, configure, keys_fetched):
    c = TestClient(app, base_url=BASE_URL)
    assert c.post("/api/session", json={"password": ADMIN_PASSWORD}).status_code == 204
    configure(access=config.CloudflareAccess(team_domain=TEAM, audience=AUD, emails=frozenset({"author@example.com"})))
    assert c.get("/api/articles").status_code == 403


@pytest.mark.parametrize(
    ("method", "path", "detail"),
    [
        ("POST", "/api/session", "password sign-in is off"),
        ("DELETE", "/api/session", "/cdn-cgi/access/logout"),
        ("DELETE", "/api/sessions", "/cdn-cgi/access/logout"),
    ],
)
def test_password_sign_in_and_sign_out_are_refused(admin, behind_access, method, path, detail):
    r = as_author().request(method, path, json={"password": ADMIN_PASSWORD} if method == "POST" else None)
    assert r.status_code == 409
    assert detail in r.json()["detail"]


def test_cross_origin_writes_are_refused_even_with_a_valid_token(behind_access):
    r = as_author().post("/api/articles", json=ARTICLE, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    assert r.json() == {"detail": "cross-origin request refused"}


def test_changes_are_logged_with_the_signed_in_email(behind_access, caplog):
    as_author().post("/api/articles", json=ARTICLE)
    TestClient(app, base_url=BASE_URL).post("/api/articles", json=ARTICLE)
    lines = [r.getMessage() for r in caplog.records if r.name == "blog.audit"]
    assert lines == [
        "method=POST path=/api/articles status=201 client=testclient user=author@example.com",
        "method=POST path=/api/articles status=403 client=testclient user=-",
    ]
