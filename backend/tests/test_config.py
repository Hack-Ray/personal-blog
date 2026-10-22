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
    ],
)
def test_malformed_settings_stop_the_start(env, message):
    with pytest.raises(config.ConfigError, match=message):
        config.load(env)


def test_each_setting_overrides_the_environment_default():
    s = config.load({**CLOUD, "COOKIE_SECURE": "0", "ENABLE_DOCS": "1"})
    assert (s.cookie_secure, s.enable_docs) == (False, True)


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


@pytest.mark.parametrize("env", [
    {"CONTENT_TRANSPORT": "api"}, {"CONTENT_TRANSPORT": "other"}, {"CONTENT_REPO": "https://github.com/a/b"},
    {"DEPLOY_REPO": "a/b/c"}, {"CONTENT_BRANCH": "../main"}, {"CONTENT_BRANCH": "main.lock"},
    {"CONTENT_BRANCH": "main\nbranch"}, {"DEPLOY_REF": "refs//heads/main"}, {"GITHUB_TIMEOUT": "nan"},
    {"GITHUB_TIMEOUT": "301"}, {"GITHUB_TIMEOUT": "abc"}, {"GITHUB_AUTH": "oauth"},
    {"GITHUB_AUTH": "app"}, {"GITHUB_APP_ID": "123"}, {"GITHUB_API_URL": "http://example.com"},
    {"GITHUB_API_URL": "https://secret@example.com"}, {"GITHUB_API_URL": "https://api.github.com?secret=1"},
])
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
