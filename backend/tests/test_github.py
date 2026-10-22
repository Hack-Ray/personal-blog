import dataclasses
import json
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from blog import config, github


@pytest.fixture
def api_server():
    calls, responses = [], []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.respond()

        def do_POST(self):
            self.respond()

        def respond(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            calls.append((self.command, self.path, self.headers["Authorization"], json.loads(raw) if raw else None))
            status, headers, data = responses.pop(0)
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", calls, responses
    server.shutdown()
    server.server_close()
    thread.join()


def test_pat_api_requests_send_auth_and_json(api_server):
    url, calls, responses = api_server
    responses.append((200, {"github-authentication-token-expiration": "2027-01-01 00:00:00 UTC"}, b'{"sha":"commit"}'))
    raw, headers = github.GitHubClient("pat-secret", url).request("POST", "/repos/writer/content/git/commits", {"message": "publish"})
    assert json.loads(raw) == {"sha": "commit"}
    assert headers["github-authentication-token-expiration"] == "2027-01-01 00:00:00 UTC"
    assert calls == [("POST", "/repos/writer/content/git/commits", "Bearer pat-secret", {"message": "publish"})]


def test_github_errors_never_echo_response_or_credentials(api_server):
    url, _, responses = api_server
    responses.append((403, {}, b'{"message":"secret-token and internal details"}'))
    with pytest.raises(github.GitHubError) as caught:
        github.GitHubClient("secret-token", url).call("GET", "/repos/writer/content")
    assert caught.value.status == 403
    assert "secret-token" not in str(caught.value)


def test_redirect_does_not_forward_authorization(api_server):
    url, calls, responses = api_server
    responses.append((302, {"Location": f"{url}/leaked"}, b""))
    with pytest.raises(github.GitHubError) as caught:
        github.GitHubClient("secret-token", url).call("GET", "/redirect")
    assert caught.value.status == 302
    assert len(calls) == 1


@pytest.mark.parametrize("raw", [b"not-json", b"[]", b"null"])
def test_malformed_api_response_is_a_safe_error(api_server, raw):
    url, _, responses = api_server
    responses.append((200, {}, raw))
    with pytest.raises(github.GitHubError, match="returned"):
        github.GitHubClient("token", url).call("GET", "/bad")


def test_app_signs_jwt_caches_token_and_refreshes_before_expiry(api_server, tmp_path, monkeypatch):
    url, calls, responses = api_server
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = tmp_path / "app.pem"
    pem.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    now = [datetime(2026, 10, 22, tzinfo=UTC).timestamp()]
    monkeypatch.setattr(github.time, "time", lambda: now[0])
    expires = datetime.fromtimestamp(now[0] + 3600, UTC).isoformat()
    responses.append((201, {}, json.dumps({"token": "first", "expires_at": expires}).encode()))
    provider = github.InstallationToken("12", "34", pem, url, 10)
    assert provider() == provider() == "first"
    assert len(calls) == 1
    assert calls[0][0:2] == ("POST", "/app/installations/34/access_tokens")
    signed = calls[0][2].removeprefix("Bearer ")
    payload = jwt.decode(signed, key.public_key(), algorithms=["RS256"], options={"verify_exp": False, "verify_iat": False})
    assert payload == {"iat": int(now[0]) - 60, "exp": int(now[0]) + 540, "iss": "12"}
    now[0] += 3550
    expires = datetime.fromtimestamp(now[0] + 3600, UTC).isoformat()
    responses.append((201, {}, json.dumps({"token": "second", "expires_at": expires}).encode()))
    assert provider() == "second"
    assert len(calls) == 2


def test_unusable_private_key_is_reported_without_its_contents(api_server, tmp_path):
    url, calls, _ = api_server
    pem = tmp_path / "app.pem"
    pem.write_text("secret-invalid-private-key")
    provider = github.InstallationToken("12", "34", pem, url, 10)
    with pytest.raises(github.GitHubError, match="private key") as caught:
        provider()
    assert "secret-invalid-private-key" not in str(caught.value)
    assert calls == []


def test_factory_selects_auth_from_current_settings(monkeypatch):
    github._client.cache_clear()
    monkeypatch.setattr(config, "settings", dataclasses.replace(config.settings, github_token=None, github_auth="token"))
    assert github.client_from_settings() is None
    monkeypatch.setattr(config, "settings", dataclasses.replace(config.settings, github_token="personal-token"))
    client = github.client_from_settings()
    assert client is github.client_from_settings()
    assert client._token == "personal-token"
