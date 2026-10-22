"""Settings, read and checked once at startup (docs/backlog.md A23).

CMS_ENV=local (the default) or cloud only picks defaults; every setting can
be set on its own. A missing or malformed setting stops the CMS from
starting instead of falling back to something unsafe.
"""

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)
LOCAL_DATABASE_URL = "postgresql+psycopg://blog:blog@127.0.0.1:5432/blog"
DEFAULT_CMS_DIST = Path(__file__).resolve().parents[2] / "cms" / "dist"


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Settings:
    env: str
    database_url: str
    # Host headers the CMS answers; anything else is refused, which keeps a
    # DNS-rebinding page off a CMS bound to 127.0.0.1.
    allowed_hosts: tuple[str, ...]
    # The Origin browsers send for the CMS. None compares with the request's
    # own scheme and host, which is right when nothing sits in front of uvicorn.
    cms_origin: str | None
    cookie_secure: bool
    enable_docs: bool
    content_repo_dir: Path | None
    deploy_repo: str | None
    github_token: str | None
    deploy_workflow: str
    deploy_ref: str
    github_api_url: str
    cms_dist: Path

    @property
    def session_cookie(self) -> str:
        # Browsers accept a __Host- cookie only over HTTPS, for the whole host.
        return "__Host-cms_session" if self.cookie_secure else "cms_session"


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name, "").strip().lower()
    if value == "":
        return default
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{name} must be 1 or 0, not {value!r}")


def _optional(env: Mapping[str, str], name: str) -> str | None:
    return env.get(name, "").strip() or None


def load(env: Mapping[str, str] = os.environ) -> Settings:
    cms_env = env.get("CMS_ENV", "local").strip() or "local"
    if cms_env not in ("local", "cloud"):
        raise ConfigError(f"CMS_ENV must be local or cloud, not {cms_env!r}")
    cloud = cms_env == "cloud"

    def required_in_cloud(name: str, local_default: str | None) -> str | None:
        value = _optional(env, name)
        if value is None and cloud:
            raise ConfigError(f"{name} must be set when CMS_ENV=cloud")
        return value or local_default

    database_url = required_in_cloud("DATABASE_URL", LOCAL_DATABASE_URL)
    hosts = tuple(h.strip() for h in required_in_cloud("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",") if h.strip())
    if not hosts or "*" in hosts:
        raise ConfigError("ALLOWED_HOSTS must list the CMS's host names; * is not allowed")
    cms_origin = required_in_cloud("CMS_ORIGIN", None)
    if cms_origin is not None:
        cms_origin = cms_origin.rstrip("/")
        if not cms_origin.startswith(("http://", "https://")) or "/" in cms_origin.split("://", 1)[1]:
            raise ConfigError(f"CMS_ORIGIN must be a scheme and host such as https://cms.example.ts.net, not {cms_origin!r}")

    token = _optional(env, "CMS_GITHUB_TOKEN")
    if token is None and (token := _optional(env, "GITHUB_TOKEN")):
        log.warning("GITHUB_TOKEN is deprecated for the CMS; rename it to CMS_GITHUB_TOKEN in backend/.env")
    repo_dir = _optional(env, "CONTENT_REPO_DIR")

    return Settings(
        env=cms_env,
        database_url=database_url,
        allowed_hosts=hosts,
        cms_origin=cms_origin,
        cookie_secure=_flag(env, "COOKIE_SECURE", cloud),
        enable_docs=_flag(env, "ENABLE_DOCS", not cloud),
        content_repo_dir=Path(repo_dir) if repo_dir else None,
        deploy_repo=_optional(env, "DEPLOY_REPO"),
        github_token=token,
        deploy_workflow=_optional(env, "DEPLOY_WORKFLOW") or "deploy.yml",
        deploy_ref=_optional(env, "DEPLOY_REF") or "main",
        github_api_url=_optional(env, "GITHUB_API_URL") or "https://api.github.com",
        cms_dist=Path(_optional(env, "CMS_DIST") or DEFAULT_CMS_DIST),
    )


settings = load()
