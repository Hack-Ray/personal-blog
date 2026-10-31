"""Settings, read and checked once at startup (docs/backlog.md A23).

CMS_ENV=local (the default) or cloud only picks defaults; every setting can
be set on its own. A missing or malformed setting stops the CMS from
starting instead of falling back to something unsafe.
"""

import logging
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

log = logging.getLogger(__name__)
LOCAL_DATABASE_URL = "postgresql+psycopg://blog:blog@127.0.0.1:5432/blog"
DEFAULT_CMS_DIST = Path(__file__).resolve().parents[2] / "cms" / "dist"


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class CloudflareAccess:
    """A CMS behind Cloudflare Access trusts the Access token, not a password (BE-026)."""

    team_domain: str
    audience: str
    emails: frozenset[str]


@dataclass(frozen=True)
class Settings:
    env: str
    database_url: str = field(repr=False)
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
    github_token: str | None = field(repr=False)
    deploy_workflow: str
    deploy_ref: str
    github_api_url: str
    github_status_url: str
    cms_dist: Path
    content_repo: str | None = None
    content_branch: str = "main"
    content_transport: str = "git"
    github_auth: str = "token"
    github_app_id: str | None = None
    github_installation_id: str | None = None
    github_private_key_file: Path | None = field(default=None, repr=False)
    github_timeout: float = 30
    cloudflare_api_token: str | None = field(default=None, repr=False)
    cloudflare_zone_id: str | None = None
    cloudflare_api_url: str = "https://api.cloudflare.com/client/v4"
    gsc_site_url: str | None = None
    gsc_credentials_file: Path | None = field(default=None, repr=False)
    gsc_api_url: str = "https://www.googleapis.com"
    backup_every_hours: int = 0
    access: CloudflareAccess | None = None
    # The infrastructure page reads CloudWatch and S3 for this host and bucket.
    aws_instance_id: str | None = None
    aws_region: str | None = None
    backup_bucket: str | None = None

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


def _origin(value: str) -> str:
    """Normalizes CMS_ORIGIN to the form a browser sends in the Origin header."""
    error = ConfigError(f"CMS_ORIGIN must be a scheme and host such as https://cms.example.ts.net, not {value!r}")
    try:
        u = urlsplit(value.rstrip("/"))
        port = u.port
    except ValueError as e:
        raise error from e
    if u.scheme not in ("http", "https") or not u.hostname or u.path or u.query or u.fragment or u.username or u.password:
        raise error
    host = f"[{u.hostname}]" if ":" in u.hostname else u.hostname
    if port in (None, {"http": 80, "https": 443}[u.scheme]):
        return f"{u.scheme}://{host}"
    return f"{u.scheme}://{host}:{port}"


def _choice(env: Mapping[str, str], name: str, choices: tuple[str, ...], default: str) -> str:
    value = _optional(env, name) or default
    if value not in choices:
        raise ConfigError(f"{name} must be one of {', '.join(choices)}")
    return value


def _repository(value: str | None, name: str) -> str | None:
    if value is not None and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+", value):
        raise ConfigError(f"{name} must have the form owner/repository")
    return value


def _branch(value: str, name: str) -> str:
    if (
        not value
        or value in ("@", "HEAD")
        or value.startswith(("/", "."))
        or value.endswith(("/", "."))
        or any(c in value for c in ("..", "@{", "//", "\\", " ", "~", "^", ":", "?", "*", "["))
        or any(ord(c) < 32 or ord(c) == 127 for c in value)
        or any(p.startswith(".") or p.endswith(".lock") for p in value.split("/"))
    ):
        raise ConfigError(f"{name} must be a valid branch name")
    return value


def _api_url(value: str, cloud: bool, name: str = "GITHUB_API_URL") -> str:
    try:
        u = urlsplit(value)
        _ = u.port
    except ValueError as e:
        raise ConfigError(f"{name} must be an HTTPS API URL") from e
    local_http = not cloud and u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost", "::1")
    if (u.scheme != "https" and not local_http) or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ConfigError(f"{name} must be HTTPS; local HTTP is allowed only for loopback test servers")
    return value.rstrip("/")


def _pair(env: Mapping[str, str], first: str, second: str) -> tuple[str | None, str | None]:
    """Two settings that only work together: both or neither."""
    a, b = _optional(env, first), _optional(env, second)
    if (a is None) != (b is None):
        missing, given = (first, second) if a is None else (second, first)
        raise ConfigError(f"{missing} must be set when {given} is set")
    return a, b


def _zone_id(value: str | None) -> str | None:
    if value is not None and not re.fullmatch(r"[0-9a-fA-F]{32}", value):
        raise ConfigError("CLOUDFLARE_ZONE_ID must be the 32-character Zone ID from the Cloudflare dashboard")
    return value.lower() if value else None


def _site_url(value: str | None) -> str | None:
    if value is None:
        return None
    domain = re.fullmatch(r"sc-domain:[a-z0-9-]+(?:\.[a-z0-9-]+)+", value)
    try:
        u = urlsplit(value)
        prefix = u.scheme in ("http", "https") and bool(u.hostname) and value.endswith("/") and not (u.query or u.fragment or u.username or u.password)
    except ValueError:
        prefix = False
    if not (domain or prefix):
        raise ConfigError("GSC_SITE_URL must be sc-domain:<domain> or a URL prefix ending in /, as the Search Console property shows it")
    return value


def _credentials_file(value: str | None) -> Path | None:
    if value is None:
        return None
    path = Path(value)
    if not path.is_file() or not os.access(path, os.R_OK):
        raise ConfigError("GSC_CREDENTIALS_FILE must point to a readable service account JSON key")
    return path


def _access(env: Mapping[str, str]) -> CloudflareAccess | None:
    names = ("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "CLOUDFLARE_ACCESS_AUD", "CLOUDFLARE_ACCESS_EMAILS")
    values = [_optional(env, n) for n in names]
    if not any(values):
        return None
    if missing := [n for n, v in zip(names, values, strict=True) if v is None]:
        raise ConfigError(f"{', '.join(missing)} must be set along with the other CLOUDFLARE_ACCESS_ settings")
    team, audience, emails = values
    team = team.lower().removeprefix("https://").removesuffix("/")
    if not re.fullmatch(r"[a-z0-9-]+(?:\.[a-z0-9-]+)+", team):
        raise ConfigError("CLOUDFLARE_ACCESS_TEAM_DOMAIN must be the team domain such as myteam.cloudflareaccess.com")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", audience):
        raise ConfigError("CLOUDFLARE_ACCESS_AUD must be the 64-character Application Audience (AUD) tag")
    allowed = frozenset(e.strip().lower() for e in emails.split(",") if e.strip())
    if not allowed or any("@" not in e for e in allowed):
        raise ConfigError("CLOUDFLARE_ACCESS_EMAILS must list email addresses separated by commas")
    return CloudflareAccess(team_domain=team, audience=audience.lower(), emails=allowed)


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
        cms_origin = _origin(cms_origin)

    token = _optional(env, "CMS_GITHUB_TOKEN")
    if token is None and (token := _optional(env, "GITHUB_TOKEN")):
        log.warning("GITHUB_TOKEN is deprecated for the CMS; rename it to CMS_GITHUB_TOKEN in backend/.env")
    repo_dir = _optional(env, "CONTENT_REPO_DIR")
    content_repo = _repository(_optional(env, "CONTENT_REPO"), "CONTENT_REPO")
    transport = _choice(env, "CONTENT_TRANSPORT", ("auto", "git", "api"), "auto")
    if transport == "auto":
        transport = "api" if content_repo else "git"
    if transport == "api" and content_repo is None:
        raise ConfigError("CONTENT_REPO must be set when CONTENT_TRANSPORT=api")
    app_id = _optional(env, "GITHUB_APP_ID")
    installation_id = _optional(env, "GITHUB_APP_INSTALLATION_ID")
    key_file = _optional(env, "GITHUB_APP_PRIVATE_KEY_FILE")
    auth = _choice(env, "GITHUB_AUTH", ("auto", "token", "app"), "auto")
    if auth == "auto":
        auth = "app" if any((app_id, installation_id, key_file)) else "token"
    if auth == "app":
        if not all((app_id, installation_id, key_file)):
            raise ConfigError("GitHub App requires GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY_FILE")
        if any(not re.fullmatch(r"[1-9][0-9]*", v) for v in (app_id, installation_id)):
            raise ConfigError("GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID must be positive integers")
        if not Path(key_file).is_file():
            raise ConfigError("GITHUB_APP_PRIVATE_KEY_FILE must point to a readable PEM file")
    try:
        timeout = float(_optional(env, "GITHUB_TIMEOUT") or "30")
    except ValueError as e:
        raise ConfigError("GITHUB_TIMEOUT must be between 1 and 300 seconds") from e
    if not 1 <= timeout <= 300:
        raise ConfigError("GITHUB_TIMEOUT must be between 1 and 300 seconds")
    cloudflare_token, zone_id = _pair(env, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID")
    site_url, credentials = _pair(env, "GSC_SITE_URL", "GSC_CREDENTIALS_FILE")
    instance_id, aws_region = _pair(env, "AWS_INSTANCE_ID", "AWS_REGION")
    if instance_id and not re.fullmatch(r"i-[0-9a-f]{8,17}", instance_id):
        raise ConfigError("AWS_INSTANCE_ID must look like i-0123456789abcdef0")
    if aws_region and not re.fullmatch(r"[a-z]{2}(-[a-z]+)+-[0-9]", aws_region):
        raise ConfigError("AWS_REGION must be a region such as ap-northeast-1")
    backup_bucket = _optional(env, "BACKUP_BUCKET")
    if backup_bucket and not instance_id:
        raise ConfigError("BACKUP_BUCKET needs AWS_INSTANCE_ID and AWS_REGION")
    if backup_bucket and not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", backup_bucket):
        raise ConfigError("BACKUP_BUCKET must be an S3 bucket name, without s3:// or a prefix")
    # A cloud host schedules backups itself (docs/cms-deployment.md), outside the container.
    backup_every = _optional(env, "BACKUP_EVERY_HOURS") or ("0" if cloud else "24")
    if not re.fullmatch(r"[0-9]+", backup_every):
        raise ConfigError("BACKUP_EVERY_HOURS must be a whole number of hours; 0 turns scheduled backups off")

    return Settings(
        env=cms_env,
        database_url=database_url,
        allowed_hosts=hosts,
        cms_origin=cms_origin,
        cookie_secure=_flag(env, "COOKIE_SECURE", cloud),
        enable_docs=_flag(env, "ENABLE_DOCS", not cloud),
        content_repo_dir=Path(repo_dir) if repo_dir else None,
        deploy_repo=_repository(_optional(env, "DEPLOY_REPO"), "DEPLOY_REPO"),
        github_token=token,
        deploy_workflow=_optional(env, "DEPLOY_WORKFLOW") or "deploy.yml",
        deploy_ref=_branch(_optional(env, "DEPLOY_REF") or "main", "DEPLOY_REF"),
        github_api_url=_api_url(_optional(env, "GITHUB_API_URL") or "https://api.github.com", cloud),
        github_status_url=_optional(env, "GITHUB_STATUS_URL") or "https://www.githubstatus.com",
        cms_dist=Path(_optional(env, "CMS_DIST") or DEFAULT_CMS_DIST),
        content_repo=content_repo,
        content_branch=_branch(_optional(env, "CONTENT_BRANCH") or "main", "CONTENT_BRANCH"),
        content_transport=transport,
        github_auth=auth,
        github_app_id=app_id,
        github_installation_id=installation_id,
        github_private_key_file=Path(key_file) if key_file else None,
        github_timeout=timeout,
        cloudflare_api_token=cloudflare_token,
        cloudflare_zone_id=_zone_id(zone_id),
        cloudflare_api_url=_api_url(_optional(env, "CLOUDFLARE_API_URL") or "https://api.cloudflare.com/client/v4", cloud, "CLOUDFLARE_API_URL"),
        gsc_site_url=_site_url(site_url),
        gsc_credentials_file=_credentials_file(credentials),
        gsc_api_url=_api_url(_optional(env, "GSC_API_URL") or "https://www.googleapis.com", cloud, "GSC_API_URL"),
        aws_instance_id=instance_id,
        aws_region=aws_region,
        backup_bucket=backup_bucket,
        backup_every_hours=int(backup_every),
        access=_access(env),
    )


settings = load()
