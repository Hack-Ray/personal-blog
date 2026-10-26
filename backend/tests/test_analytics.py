import json
import threading
from datetime import UTC, date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from blog import analytics
from blog.db import SessionLocal, advisory_lock

ZONE = "0123456789abcdef0123456789abcdef"
SITE = "sc-domain:example.com"
CF_TOKEN = "cf-secret-token"
ACCESS_TOKEN = "google-access-secret"
NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
TODAY = NOW.date()
SEARCH_PATH = "/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query"


def day(n: int) -> str:
    """The ISO date n days before TODAY."""
    return (TODAY - timedelta(days=n)).isoformat()


@pytest.fixture
def apis():
    """A loopback stand-in for Cloudflare and Google: `routes` maps a path to a
    function from the request to (status, JSON body); `calls` records requests."""
    calls, routes = [], {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            is_form = self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded")
            body = {k: v[0] for k, v in parse_qs(raw.decode()).items()} if is_form else json.loads(raw)
            call = {"path": self.path, "authorization": self.headers.get("Authorization"), "body": body}
            calls.append(call)
            status, response = routes[self.path](call)
            data = json.dumps(response).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", calls, routes
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture(scope="module")
def private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def cloudflare(apis, configure):
    url, calls, routes = apis
    configure(cloudflare_api_token=CF_TOKEN, cloudflare_zone_id=ZONE, cloudflare_api_url=url)
    return calls, routes


@pytest.fixture
def search_console(apis, configure, private_key, tmp_path):
    url, calls, routes = apis
    pem = private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    key = tmp_path / "service-account.json"
    key.write_text(
        json.dumps({"type": "service_account", "client_email": "reader@project.iam.gserviceaccount.com", "private_key": pem, "token_uri": f"{url}/token"})
    )
    configure(gsc_site_url=SITE, gsc_credentials_file=key, gsc_api_url=url)
    routes["/token"] = lambda call: (200, {"access_token": ACCESS_TOKEN, "expires_in": 3599, "token_type": "Bearer"})
    return calls, routes


def cloudflare_answer(*days):
    groups = [
        {
            "dimensions": {"date": d},
            "sum": {"requests": requests, "cachedRequests": cached, "bytes": size, "cachedBytes": size // 2, "pageViews": views},
            "uniq": {"uniques": visitors},
        }
        for d, requests, cached, size, views, visitors in days
    ]
    return lambda call: (200, {"data": {"viewer": {"zones": [{"httpRequests1dGroups": groups}]}}, "errors": None})


def search_answer(totals=(), queries=(), pages=()):
    """Answers the three Search Console queries by their dimensions."""
    by_dimensions = {("date",): totals, ("date", "query"): queries, ("date", "page"): pages}

    def answer(call):
        rows = by_dimensions[tuple(call["body"]["dimensions"])]
        if not rows:
            return 200, {"responseAggregationType": "byProperty"}
        return 200, {"rows": [{"keys": list(keys), "clicks": c, "impressions": i, "ctr": c / i, "position": p} for *keys, c, i, p in rows]}

    return answer


def sync(now=NOW, force=False):
    with SessionLocal() as session:
        return {s.source: s for s in analytics.sync(session, now, force=force)}


def report(days=28, now=NOW):
    with SessionLocal() as session:
        return analytics.report(session, days, now)


def test_without_settings_the_page_explains_and_sync_calls_nothing(client, apis, configure):
    url, calls, _ = apis
    configure(cloudflare_api_url=url, gsc_api_url=url)
    r = client.get("/api/analytics")
    assert r.status_code == 200
    body = r.json()
    assert [(s["source"], s["configured"], s["stale"]) for s in body["sources"]] == [("cloudflare", False, False), ("search_console", False, False)]
    assert body["traffic"] == [] and body["traffic_totals"]["requests"] == 0 and body["search_totals"]["position"] is None
    synced = client.post("/api/analytics/sync", json={"force": True})
    assert synced.status_code == 200
    assert [s["synced_at"] for s in synced.json()] == [None, None]
    assert calls == []


def test_cloudflare_sync_stores_days_and_the_report_adds_them_up(client, cloudflare):
    calls, routes = cloudflare
    today = datetime.now(UTC).date()
    routes["/graphql"] = cloudflare_answer(
        ((today - timedelta(days=1)).isoformat(), 1000, 750, 4_000_000, 120, 40),
        (today.isoformat(), 600, 450, 2_000_000, 80, 30),
    )
    statuses = client.post("/api/analytics/sync").json()
    assert statuses[0]["source"] == "cloudflare" and statuses[0]["synced_at"] and statuses[0]["error"] is None and not statuses[0]["stale"]
    assert calls[0]["authorization"] == f"Bearer {CF_TOKEN}"
    assert calls[0]["body"]["variables"] == {"zone": ZONE, "start": (today - timedelta(days=29)).isoformat(), "end": today.isoformat()}

    body = client.get("/api/analytics?days=7").json()
    assert body["traffic_totals"] == {"requests": 1600, "page_views": 200, "visitors": 70, "bytes": 6_000_000, "cache_hit_ratio": 0.75}
    assert [(d["day"], d["page_views"], d["visitors"]) for d in body["traffic"]] == [
        ((today - timedelta(days=1)).isoformat(), 120, 40),
        (today.isoformat(), 80, 30),
    ]


def test_the_report_covers_only_the_chosen_range(cloudflare):
    _, routes = cloudflare
    routes["/graphql"] = cloudflare_answer((day(10), 100, 0, 1, 10, 1), (day(6), 200, 0, 1, 20, 2), (day(0), 300, 0, 1, 30, 3))
    sync()
    assert report(7).traffic_totals.page_views == 50
    assert report(28).traffic_totals.page_views == 60


def test_syncing_again_converges_to_the_latest_answer(cloudflare):
    calls, routes = cloudflare
    routes["/graphql"] = cloudflare_answer((day(1), 100, 50, 10, 5, 2), (day(0), 40, 10, 10, 4, 1))
    sync()
    first = report()
    sync(force=True)
    assert report() == first
    # Cloudflare's count for today grows during the day; a re-fetch replaces it.
    routes["/graphql"] = cloudflare_answer((day(1), 100, 50, 10, 5, 2), (day(0), 90, 60, 10, 9, 3))
    sync(force=True)
    totals = report().traffic_totals
    assert (totals.requests, totals.page_views, totals.visitors) == (190, 14, 5)
    assert len(calls) == 3


def test_a_fresh_source_is_not_fetched_until_it_is_stale_or_forced(cloudflare):
    calls, routes = cloudflare
    routes["/graphql"] = cloudflare_answer()
    sync()
    sync(NOW + timedelta(hours=5))
    assert len(calls) == 1
    sync(NOW + timedelta(hours=5), force=True)
    assert len(calls) == 2
    status = sync(NOW + timedelta(hours=11, minutes=1))["cloudflare"]
    assert len(calls) == 3 and status.synced_at == NOW + timedelta(hours=11, minutes=1)


def test_first_sync_backfills_and_later_syncs_refetch_a_short_window(cloudflare, search_console):
    calls, routes = cloudflare
    routes["/graphql"] = cloudflare_answer()
    routes[SEARCH_PATH] = search_answer()

    def windows():
        cf = [(c["body"]["variables"]["start"], c["body"]["variables"]["end"]) for c in calls if c["path"] == "/graphql"]
        gsc = {(c["body"]["startDate"], c["body"]["endDate"]) for c in calls if c["path"] == SEARCH_PATH}
        calls.clear()
        return cf, gsc

    sync()
    assert windows() == ([(day(29), day(0))], {(day(89), day(0))})
    later = NOW + timedelta(days=4)
    sync(later)
    cf, gsc = windows()
    assert cf == [(day(2), (later.date()).isoformat())]
    assert gsc == {(day(9), later.date().isoformat())}
    # After a long break, the window reaches back to the last sync, but never past the backfill.
    much_later = NOW + timedelta(days=60)
    sync(much_later)
    cf, gsc = windows()
    assert cf == [((much_later.date() - timedelta(days=29)).isoformat(), much_later.date().isoformat())]
    assert gsc == {((later.date() - timedelta(days=9)).isoformat(), much_later.date().isoformat())}


def test_cloudflare_ranges_longer_than_30_days_are_split(cloudflare):
    calls, routes = cloudflare
    routes["/graphql"] = cloudflare_answer()
    from blog import config

    analytics.fetch_cloudflare(config.settings, date(2026, 1, 1), date(2026, 3, 1))
    assert [(c["body"]["variables"]["start"], c["body"]["variables"]["end"]) for c in calls] == [
        ("2026-01-01", "2026-01-30"),
        ("2026-01-31", "2026-03-01"),
    ]


def test_one_failing_source_is_recorded_and_the_other_still_syncs(cloudflare, search_console):
    _, routes = cloudflare
    routes["/graphql"] = lambda call: (200, {"data": None, "errors": [{"message": "zone analytics are not available for this account"}]})
    routes[SEARCH_PATH] = search_answer(totals=[(day(3), 5, 100, 4.0)])
    statuses = sync()
    assert statuses["cloudflare"].synced_at is None
    assert "zone analytics are not available" in statuses["cloudflare"].error
    assert statuses["cloudflare"].stale
    assert statuses["search_console"].synced_at == NOW and statuses["search_console"].error is None
    assert report().search_totals.clicks == 5

    routes["/graphql"] = cloudflare_answer((day(0), 10, 5, 1, 1, 1))
    recovered = sync(NOW + timedelta(minutes=1))["cloudflare"]
    assert recovered.error is None and recovered.synced_at == NOW + timedelta(minutes=1)


def test_unreachable_api_is_an_error_not_a_crash(cloudflare, configure):
    configure(cloudflare_api_url="http://127.0.0.1:9")
    status = sync()["cloudflare"]
    assert status.synced_at is None and "unreachable" in status.error


def test_search_console_reports_totals_and_top_queries_and_pages(apis, search_console, private_key):
    calls, routes = search_console
    routes[SEARCH_PATH] = search_answer(
        totals=[(day(4), 10, 200, 5.0), (day(3), 30, 600, 9.0)],
        queries=[
            (day(4), "postgres advisory lock", 6, 100, 3.0),
            (day(3), "postgres advisory lock", 4, 300, 7.0),
            (day(3), "fastapi threadpool", 10, 50, 2.0),
            (day(3), "rare query", 0, 80, 20.0),
        ],
        pages=[(day(3), "https://example.com/posts/a/", 25, 500, 8.0), (day(4), "https://example.com/", 2, 40, 1.5)],
    )
    sync()

    token_call, *queries = calls
    assert token_call["path"] == "/token"
    assert token_call["body"]["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    claims = jwt.decode(token_call["body"]["assertion"], private_key.public_key(), algorithms=["RS256"], audience=f"{apis[0]}/token")
    assert claims["iss"] == "reader@project.iam.gserviceaccount.com"
    assert claims["scope"] == "https://www.googleapis.com/auth/webmasters.readonly"
    assert claims["exp"] - claims["iat"] == 3600
    assert sorted(tuple(q["body"]["dimensions"]) for q in queries) == [("date",), ("date", "page"), ("date", "query")]
    assert {q["authorization"] for q in queries} == {f"Bearer {ACCESS_TOKEN}"}

    r = report()
    assert (r.search_totals.clicks, r.search_totals.impressions, r.search_totals.ctr) == (40, 800, 0.05)
    # Weighted by impressions: (5 * 200 + 9 * 600) / 800.
    assert r.search_totals.position == 8.0
    assert [(d.day.isoformat(), d.clicks, d.impressions) for d in r.search] == [(day(4), 10, 200), (day(3), 30, 600)]
    assert [(q.key, q.clicks, q.impressions) for q in r.top_queries] == [
        ("postgres advisory lock", 10, 400),
        ("fastapi threadpool", 10, 50),
        ("rare query", 0, 80),
    ]
    # (3 * 100 + 7 * 300) / 400
    assert r.top_queries[0].position == 6.0 and r.top_queries[0].ctr == 0.025
    assert [p.key for p in r.top_pages] == ["https://example.com/posts/a/", "https://example.com/"]


def test_queries_that_vanish_from_a_refetched_day_are_removed(search_console):
    _, routes = search_console
    routes[SEARCH_PATH] = search_answer(totals=[(day(5), 3, 30, 4.0)], queries=[(day(5), "old wording", 3, 30, 4.0)])
    sync()
    routes[SEARCH_PATH] = search_answer(totals=[(day(5), 3, 30, 4.0)], queries=[(day(5), "new wording", 3, 30, 4.0)])
    sync(force=True)
    assert [q.key for q in report().top_queries] == ["new wording"]


def test_days_outside_the_refetch_window_are_kept(search_console):
    _, routes = search_console
    routes[SEARCH_PATH] = search_answer(totals=[(day(30), 7, 70, 3.0)], queries=[(day(30), "kept", 7, 70, 3.0)])
    sync()
    routes[SEARCH_PATH] = search_answer()
    sync(NOW + timedelta(days=1))
    assert [q.key for q in report(90).top_queries] == ["kept"]


@pytest.mark.parametrize("echo", [CF_TOKEN, ACCESS_TOKEN])
def test_stored_errors_never_contain_a_token(cloudflare, search_console, echo):
    _, routes = cloudflare
    routes["/graphql"] = lambda call: (403, {"errors": [{"message": f"bad token {call['authorization']}"}]})
    routes[SEARCH_PATH] = lambda call: (403, {"error": {"code": 403, "message": f"{call['authorization']} has no access to {SITE}"}})
    statuses = sync()
    for s in statuses.values():
        assert s.error and "403" in s.error
        assert echo not in s.error
    assert "has no access to sc-domain:example.com" in statuses["search_console"].error


def test_a_bad_key_file_is_a_stored_error(search_console, configure, tmp_path):
    key = tmp_path / "not-a-key.json"
    key.write_text('{"client_email": "reader@example.com"}')
    configure(gsc_credentials_file=key)
    status = sync()["search_console"]
    assert status.synced_at is None and "GSC_CREDENTIALS_FILE" in status.error


@pytest.mark.parametrize("response", [{"data": {"viewer": {"zones": []}}}, {"data": {"viewer": {"zones": [{"httpRequests1dGroups": [{"x": 1}]}]}}}])
def test_unexpected_cloudflare_answers_are_errors(cloudflare, response):
    _, routes = cloudflare
    routes["/graphql"] = lambda call: (200, response)
    assert sync()["cloudflare"].error.startswith("Cloudflare")
    assert report().traffic == []


def test_a_sync_already_running_is_not_repeated(cloudflare):
    calls, routes = cloudflare
    routes["/graphql"] = cloudflare_answer()
    with advisory_lock(analytics.LOCK_KEY) as held:
        assert held
        statuses = sync()
    assert calls == [] and statuses["cloudflare"].stale


@pytest.mark.parametrize("days", [7, 28, 90])
def test_the_report_offers_three_ranges(client, days):
    body = client.get(f"/api/analytics?days={days}").json()
    assert date.fromisoformat(body["end"]) - date.fromisoformat(body["start"]) == timedelta(days=days - 1)


@pytest.mark.parametrize("days", ["0", "30", "365", "week"])
def test_other_ranges_are_refused(client, days):
    assert client.get(f"/api/analytics?days={days}").status_code == 422


def test_analytics_needs_sign_in(anon):
    assert anon.get("/api/analytics").status_code == 401
    assert anon.post("/api/analytics/sync", json={}).status_code == 401
