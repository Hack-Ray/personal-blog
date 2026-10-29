import pytest
from fastapi.testclient import TestClient

from blog import config
from blog.api import app
from tests.conftest import ADMIN_PASSWORD

CLOUD = {
    "CMS_ENV": "cloud",
    "DATABASE_URL": "postgresql+psycopg://cms@db.internal/blog",
    "ALLOWED_HOSTS": "cms.example.ts.net",
    "CMS_ORIGIN": "https://cms.example.ts.net/",
}


def test_local_defaults_need_no_settings():
    s = config.load({})
    assert (s.env, s.database_url, s.allowed_hosts) == ("local", config.LOCAL_DATABASE_URL, ("127.0.0.1", "localhost"))
    assert (s.cms_origin, s.cookie_secure, s.enable_docs, s.session_cookie) == (None, False, True, "cms_session")


def test_cloud_defaults_are_secure():
    s = config.load(CLOUD)
    assert (s.cms_origin, s.cookie_secure, s.enable_docs) == ("https://cms.example.ts.net", True, False)
    assert s.session_cookie == "__Host-cms_session"


@pytest.mark.parametrize("missing", ["DATABASE_URL", "ALLOWED_HOSTS", "CMS_ORIGIN"])
def test_cloud_refuses_to_start_without_its_required_settings(missing):
    with pytest.raises(config.ConfigError, match=f"{missing} must be set"):
        config.load({k: v for k, v in CLOUD.items() if k != missing})


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"CMS_ENV": "prod"}, "CMS_ENV must be local or cloud"),
        ({"ALLOWED_HOSTS": "*"}, r"\* is not allowed"),
        ({"COOKIE_SECURE": "yes please"}, "COOKIE_SECURE must be 1 or 0"),
        ({"CMS_ORIGIN": "cms.example.ts.net"}, "CMS_ORIGIN must be a scheme and host"),
        ({"CMS_ORIGIN": "https://cms.example.ts.net/admin"}, "CMS_ORIGIN must be a scheme and host"),
        ({"CMS_ORIGIN": "https://cms.example.ts.net?x"}, "CMS_ORIGIN must be a scheme and host"),
        ({"CMS_ORIGIN": "https://user@cms.example.ts.net"}, "CMS_ORIGIN must be a scheme and host"),
        ({"CMS_ORIGIN": "https://cms.example.ts.net:99999"}, "CMS_ORIGIN must be a scheme and host"),
        ({"CMS_ORIGIN": "https://"}, "CMS_ORIGIN must be a scheme and host"),
        ({"BACKUP_EVERY_HOURS": "1.5"}, "BACKUP_EVERY_HOURS must be a whole number"),
    ],
)
def test_malformed_settings_stop_the_start(env, message):
    with pytest.raises(config.ConfigError, match=message):
        config.load(env)


def test_each_setting_overrides_the_environment_default():
    s = config.load({**CLOUD, "COOKIE_SECURE": "0", "ENABLE_DOCS": "1", "BACKUP_EVERY_HOURS": "12"})
    assert (s.cookie_secure, s.enable_docs, s.backup_every_hours) == (False, True, 12)


def test_a_local_cms_backs_up_daily_and_a_cloud_one_leaves_it_to_the_host():
    assert config.load({}).backup_every_hours == 24
    assert config.load({"BACKUP_EVERY_HOURS": "0"}).backup_every_hours == 0
    assert config.load(CLOUD).backup_every_hours == 0


def test_the_old_github_token_name_still_works(caplog):
    assert config.load({"GITHUB_TOKEN": "old"}).github_token == "old"
    assert "CMS_GITHUB_TOKEN" in caplog.text
    assert config.load({"GITHUB_TOKEN": "old", "CMS_GITHUB_TOKEN": "new"}).github_token == "new"


def test_hosts_come_from_the_settings_and_healthz_answers_any_host(configure):
    configure(allowed_hosts=("cms.example.ts.net",))
    assert TestClient(app, base_url="http://127.0.0.1:8000").get("/api/session").status_code == 400
    assert TestClient(app, base_url="https://cms.example.ts.net").get("/api/session").status_code == 200
    assert TestClient(app, base_url="http://10.0.0.5:8000").get("/healthz").json() == {"status": "ok"}


def test_behind_an_https_proxy_the_configured_origin_is_expected(admin, configure):
    configure(cms_origin="https://cms.example.ts.net")
    # tailscale serve forwards to uvicorn over plain http on 127.0.0.1.
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    sign_in = {"json": {"password": ADMIN_PASSWORD}}
    assert c.post("/api/session", headers={"origin": "http://127.0.0.1:8000"}, **sign_in).status_code == 403
    assert c.post("/api/session", headers={"origin": "https://cms.example.ts.net"}, **sign_in).status_code == 204


def test_a_secure_cookie_uses_the_host_prefix(admin, configure):
    configure(cookie_secure=True)
    r = TestClient(app, base_url="https://127.0.0.1").post("/api/session", json={"password": ADMIN_PASSWORD})
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("__Host-cms_session=")
    assert "Secure" in cookie and "Path=/" in cookie and "Domain" not in cookie


@pytest.mark.parametrize(
    ("value", "origin"),
    [
        ("https://CMS.Example.ts.net:443/", "https://cms.example.ts.net"),
        ("http://127.0.0.1:80", "http://127.0.0.1"),
        ("https://cms.example.ts.net:8443", "https://cms.example.ts.net:8443"),
        ("http://[::1]:8000", "http://[::1]:8000"),
    ],
)
def test_cms_origin_takes_the_form_browsers_send(value, origin):
    assert config.load({**CLOUD, "CMS_ORIGIN": value}).cms_origin == origin


def test_api_transport_is_selected_without_a_clone():
    s = config.load({"CONTENT_REPO": "writer/content", "CONTENT_BRANCH": "publish/site"})
    assert (s.content_transport, s.content_repo, s.content_branch, s.content_repo_dir) == ("api", "writer/content", "publish/site", None)
    assert config.load({"CONTENT_REPO_DIR": "/tmp/content"}).content_transport == "git"
    assert config.load({"CONTENT_REPO": "writer/content", "CONTENT_TRANSPORT": "git"}).content_transport == "git"


@pytest.mark.parametrize(
    "env",
    [
        {"CONTENT_TRANSPORT": "api"},
        {"CONTENT_TRANSPORT": "other"},
        {"CONTENT_REPO": "https://github.com/a/b"},
        {"DEPLOY_REPO": "a/b/c"},
        {"CONTENT_BRANCH": "../main"},
        {"CONTENT_BRANCH": "main.lock"},
        {"CONTENT_BRANCH": "main\nbranch"},
        {"DEPLOY_REF": "refs//heads/main"},
        {"GITHUB_TIMEOUT": "nan"},
        {"GITHUB_TIMEOUT": "301"},
        {"GITHUB_TIMEOUT": "abc"},
        {"GITHUB_AUTH": "oauth"},
        {"GITHUB_AUTH": "app"},
        {"GITHUB_APP_ID": "123"},
        {"GITHUB_API_URL": "http://example.com"},
        {"GITHUB_API_URL": "https://secret@example.com"},
        {"GITHUB_API_URL": "https://api.github.com?secret=1"},
    ],
)
def test_publishing_settings_reject_invalid_values(env):
    with pytest.raises(config.ConfigError):
        config.load(env)


def test_api_url_allows_local_test_server_but_never_in_cloud():
    assert config.load({"GITHUB_API_URL": "http://127.0.0.1:12345"}).github_api_url == "http://127.0.0.1:12345"
    with pytest.raises(config.ConfigError):
        config.load({**CLOUD, "GITHUB_API_URL": "http://127.0.0.1:12345"})


def test_app_configuration_can_be_selected_in_either_environment(tmp_path):
    key = tmp_path / "app.pem"
    key.write_text("private key validated on use")
    app = {"GITHUB_APP_ID": "12", "GITHUB_APP_INSTALLATION_ID": "34", "GITHUB_APP_PRIVATE_KEY_FILE": str(key)}
    for env in ({}, CLOUD):
        settings = config.load({**env, **app})
        assert settings.github_auth == "app"
        assert settings.github_private_key_file == key
    assert config.load({**app, "GITHUB_AUTH": "token", "CMS_GITHUB_TOKEN": "token"}).github_auth == "token"
    for bad in ("0", "abc", "-1"):
        with pytest.raises(config.ConfigError):
            config.load({**app, "GITHUB_APP_ID": bad})


def test_settings_do_not_display_credentials():
    s = config.load({"CMS_GITHUB_TOKEN": "dont-show-token", "DATABASE_URL": "postgresql://dont-show-password"})
    assert "dont-show" not in repr(s)


ZONE = "0123456789abcdef0123456789abcdef"


def test_traffic_sources_are_off_until_both_settings_of_a_pair_are_set(tmp_path):
    key = tmp_path / "search-console.json"
    key.write_text("{}")
    s = config.load({})
    assert (s.cloudflare_api_token, s.cloudflare_zone_id, s.gsc_site_url, s.gsc_credentials_file) == (None, None, None, None)
    search_console = {"GSC_SITE_URL": "sc-domain:example.com", "GSC_CREDENTIALS_FILE": str(key)}
    s = config.load({"CLOUDFLARE_API_TOKEN": "cf-token", "CLOUDFLARE_ZONE_ID": ZONE.upper(), **search_console})
    assert (s.cloudflare_api_token, s.cloudflare_zone_id, s.gsc_site_url, s.gsc_credentials_file) == ("cf-token", ZONE, "sc-domain:example.com", key)
    assert config.load({"GSC_SITE_URL": "https://example.com/blog/", "GSC_CREDENTIALS_FILE": str(key)}).gsc_site_url == "https://example.com/blog/"


@pytest.mark.parametrize(
    ("env", "missing"),
    [
        ({"CLOUDFLARE_API_TOKEN": "cf-token"}, "CLOUDFLARE_ZONE_ID"),
        ({"CLOUDFLARE_ZONE_ID": ZONE}, "CLOUDFLARE_API_TOKEN"),
        ({"GSC_SITE_URL": "sc-domain:example.com"}, "GSC_CREDENTIALS_FILE"),
        ({"GSC_CREDENTIALS_FILE": "key.json"}, "GSC_SITE_URL"),
    ],
)
def test_half_a_traffic_source_pair_names_the_missing_setting(env, missing):
    with pytest.raises(config.ConfigError, match=f"^{missing} must be set"):
        config.load(env)


@pytest.mark.parametrize(
    ("env", "name"),
    [
        ({"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ZONE_ID": "example.com"}, "CLOUDFLARE_ZONE_ID"),
        ({"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ZONE_ID": ZONE + "0"}, "CLOUDFLARE_ZONE_ID"),
        ({"GSC_SITE_URL": "example.com", "GSC_CREDENTIALS_FILE": "key.json"}, "GSC_SITE_URL"),
        ({"GSC_SITE_URL": "https://example.com", "GSC_CREDENTIALS_FILE": "key.json"}, "GSC_SITE_URL"),
        ({"GSC_SITE_URL": "sc-domain:https://example.com", "GSC_CREDENTIALS_FILE": "key.json"}, "GSC_SITE_URL"),
        ({"GSC_SITE_URL": "sc-domain:example.com", "GSC_CREDENTIALS_FILE": "/nonexistent/key.json"}, "GSC_CREDENTIALS_FILE"),
        ({"CLOUDFLARE_API_URL": "http://example.com"}, "CLOUDFLARE_API_URL"),
        ({"GSC_API_URL": "https://user:pass@example.com"}, "GSC_API_URL"),
    ],
)
def test_malformed_traffic_settings_stop_the_start(env, name):
    with pytest.raises(config.ConfigError, match=f"^{name} must"):
        config.load(env)


def test_traffic_api_urls_allow_loopback_only_outside_the_cloud():
    s = config.load({"CLOUDFLARE_API_URL": "http://127.0.0.1:9000/", "GSC_API_URL": "http://localhost:9001"})
    assert (s.cloudflare_api_url, s.gsc_api_url) == ("http://127.0.0.1:9000", "http://localhost:9001")
    with pytest.raises(config.ConfigError, match="CLOUDFLARE_API_URL"):
        config.load({**CLOUD, "CLOUDFLARE_API_URL": "http://127.0.0.1:9000"})


def test_settings_do_not_display_traffic_credentials(tmp_path):
    key = tmp_path / "dont-show-key.json"
    key.write_text("{}")
    search_console = {"GSC_SITE_URL": "sc-domain:example.com", "GSC_CREDENTIALS_FILE": str(key)}
    s = config.load({"CLOUDFLARE_API_TOKEN": "dont-show-cf", "CLOUDFLARE_ZONE_ID": ZONE, **search_console})
    assert "dont-show" not in repr(s)


AUD = "0123456789abcdef" * 4
ACCESS = {"CLOUDFLARE_ACCESS_TEAM_DOMAIN": "myteam.cloudflareaccess.com", "CLOUDFLARE_ACCESS_AUD": AUD, "CLOUDFLARE_ACCESS_EMAILS": "author@example.com"}


def test_password_sign_in_is_the_default():
    assert config.load({}).access is None
    assert config.load(CLOUD).access is None


def test_cloudflare_access_settings_are_normalised():
    s = config.load(
        {
            **CLOUD,
            "CLOUDFLARE_ACCESS_TEAM_DOMAIN": "https://MyTeam.cloudflareaccess.com/",
            "CLOUDFLARE_ACCESS_AUD": AUD.upper(),
            "CLOUDFLARE_ACCESS_EMAILS": " Author@Example.com, second@example.com ,",
        }
    )
    assert s.access == config.CloudflareAccess(
        team_domain="myteam.cloudflareaccess.com", audience=AUD, emails=frozenset({"author@example.com", "second@example.com"})
    )


@pytest.mark.parametrize("missing", list(ACCESS))
def test_cloudflare_access_needs_all_three_settings(missing):
    with pytest.raises(config.ConfigError, match=f"^{missing} must be set"):
        config.load({k: v for k, v in ACCESS.items() if k != missing})


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "http://myteam.cloudflareaccess.com"),
        ("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "https://myteam.cloudflareaccess.com/cdn-cgi/access/certs"),
        ("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "myteam.cloudflareaccess.com:443"),
        ("CLOUDFLARE_ACCESS_TEAM_DOMAIN", "myteam"),
        ("CLOUDFLARE_ACCESS_AUD", AUD[:-1]),
        ("CLOUDFLARE_ACCESS_AUD", AUD[:-1] + "g"),
        ("CLOUDFLARE_ACCESS_EMAILS", "author"),
        ("CLOUDFLARE_ACCESS_EMAILS", "author@example.com,someone"),
        ("CLOUDFLARE_ACCESS_EMAILS", ","),
    ],
)
def test_malformed_cloudflare_access_settings_stop_the_start(name, value):
    with pytest.raises(config.ConfigError, match=f"^{name} must"):
        config.load({**ACCESS, name: value})
