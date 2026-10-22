import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime
from email.message import Message
from functools import lru_cache
from pathlib import Path

import jwt

from blog import config


class GitHubError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubClient:
    def __init__(self, token: str | Callable[[], str], api_url: str = "https://api.github.com", timeout: float = 30):
        self._token = token
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        self._opener = urllib.request.build_opener(_NoRedirect())

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[bytes, Message]:
        if not path.startswith("/") or path.startswith("//"):
            raise GitHubError("GitHub API path must be relative to the configured API host")
        token = self._token() if callable(self._token) else self._token
        request = urllib.request.Request(
            f"{self.api_url}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "authorization": f"Bearer {token}", "accept": "application/vnd.github+json",
                "x-github-api-version": "2022-11-28", "content-type": "application/json",
                "user-agent": "personal-blog-cms",
            },
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                return response.read(), response.headers
        except urllib.error.HTTPError as e:
            raise GitHubError(f"GitHub API {method} {path} returned {e.code}", status=e.code) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise GitHubError("GitHub API is unreachable or timed out") from None

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        raw, _ = self.request(method, path, body)
        try:
            value = json.loads(raw) if raw else {}
        except (ValueError, UnicodeDecodeError):
            raise GitHubError("GitHub API returned invalid JSON") from None
        if not isinstance(value, dict):
            raise GitHubError("GitHub API returned an unexpected response")
        return value


class InstallationToken:
    def __init__(self, app_id: str, installation_id: str, key_file: Path, api_url: str, timeout: float):
        self.app_id = app_id
        self.installation_id = installation_id
        self.key_file = key_file
        self.api_url = api_url
        self.timeout = timeout
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def __call__(self) -> str:
        with self._lock:
            now = time.time()
            if self._token is not None and now + 60 < self._expires_at:
                return self._token
            try:
                signed = jwt.encode(
                    {"iat": int(now) - 60, "exp": int(now) + 540, "iss": self.app_id},
                    self.key_file.read_bytes(), algorithm="RS256",
                )
            except (OSError, ValueError, jwt.PyJWTError):
                raise GitHubError("GitHub App private key could not be read or used to sign a token") from None
            client = GitHubClient(signed, self.api_url, self.timeout)
            data = client.call("POST", f"/app/installations/{self.installation_id}/access_tokens")
            try:
                token = data["token"]
                expiry = datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00"))
                if not isinstance(token, str) or not token or expiry.tzinfo is None or expiry.timestamp() <= now + 60:
                    raise ValueError
            except (KeyError, ValueError, TypeError, AttributeError):
                raise GitHubError("GitHub App returned an invalid installation token") from None
            self._token = token
            self._expires_at = expiry.timestamp()
            return token


@lru_cache(maxsize=4)
def _client(settings: config.Settings) -> GitHubClient | None:
    if settings.github_auth == "app":
        token = InstallationToken(
            settings.github_app_id, settings.github_installation_id, settings.github_private_key_file,
            settings.github_api_url, settings.github_timeout,
        )
    elif settings.github_token:
        token = settings.github_token
    else:
        return None
    return GitHubClient(token, settings.github_api_url, settings.github_timeout)


def client_from_settings() -> GitHubClient | None:
    return _client(config.settings)
