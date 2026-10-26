"""Site traffic from Cloudflare and search data from Google Search Console.

Both come from the services' own APIs, so the public site runs no tracking
script. Nothing is scheduled: the CMS page asks for a sync when the stored
data is older than STALE, and a source without settings is never called.
"""

import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from urllib.parse import quote, urlencode, urlsplit

import jwt
from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from blog import config
from blog.db import advisory_lock
from blog.models import AnalyticsSource, SearchDay, TrafficDay

log = logging.getLogger(__name__)

# Arbitrary key for pg_try_advisory_lock, distinct from the other LOCK_KEYs.
LOCK_KEY = 0x7472_6166
STALE = timedelta(hours=6)
# A failing source is retried at most this often, so a wrong token does not
# make every page open wait on the API again.
RETRY_AFTER = timedelta(minutes=10)
INSERT_BATCH = 5000
RANGES = (7, 28, 90)
TOP = 10
TIMEOUT = 30
MAX_RESPONSE = 32 * 1024 * 1024
GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
GSC_ROW_LIMIT = 25000
CLOUDFLARE_MAX_DAYS = 30
# Values are inlined rather than passed as variables because Cloudflare's
# schema names its scalars in lower case (string, Date), which is easy to get
# wrong; the zone id is checked to be hex and the dates are ISO dates.
CLOUDFLARE_QUERY = """
{
  viewer {
    zones(filter: {zoneTag: "%(zone)s"}) {
      httpRequests1dGroups(limit: 100, filter: {date_geq: "%(start)s", date_leq: "%(end)s"}, orderBy: [date_ASC]) {
        dimensions { date }
        sum { requests cachedRequests bytes cachedBytes pageViews }
        uniq { uniques }
      }
    }
  }
}
"""


class AnalyticsError(Exception):
    """A failed fetch; the message is safe to store and show."""


# --- HTTP and parsing: the boundary with Cloudflare and Google ---


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect())


def _short(text: str, limit: int = 200) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _error_detail(body: object) -> str:
    """The message an API put in its error body, if it has one."""
    if not isinstance(body, dict):
        return ""
    errors = body.get("errors")
    for candidate in (body.get("error"), *(errors[:1] if isinstance(errors, list) else [])):
        if isinstance(candidate, dict) and isinstance(candidate.get("message"), str):
            return candidate["message"]
        if isinstance(candidate, str):
            description = body.get("error_description")
            return f"{candidate}: {description}" if isinstance(description, str) else candidate
    return ""


def _safe(message: str, secrets: Sequence[str]) -> AnalyticsError:
    for secret in secrets:
        message = message.replace(secret, "***")
    return AnalyticsError(_short(message))


def _post(service: str, url: str, data: bytes, headers: dict[str, str], secrets: Sequence[str] = ()) -> dict:
    """POSTs and returns the JSON object answered; any failure is one AnalyticsError
    whose message never contains `secrets`."""
    request = urllib.request.Request(url, data=data, method="POST", headers={"user-agent": "personal-blog-cms", **headers})
    try:
        with _opener.open(request, timeout=TIMEOUT) as response:
            raw = response.read(MAX_RESPONSE + 1)
    except urllib.error.HTTPError as e:
        try:
            detail = _error_detail(json.loads(e.read(64 * 1024)))
        except (ValueError, UnicodeDecodeError):
            detail = ""
        raise _safe(f"{service} returned HTTP {e.code}" + (f": {detail}" if detail else ""), secrets) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise _safe(f"{service} is unreachable or timed out", secrets) from None
    if len(raw) > MAX_RESPONSE:
        raise _safe(f"{service} returned a response that is too large", secrets)
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise _safe(f"{service} returned invalid JSON", secrets) from None
    if not isinstance(body, dict):
        raise _safe(f"{service} returned an unexpected response", secrets)
    return body


def _count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        raise ValueError
    return int(value)


@dataclass(frozen=True)
class CloudflareDay:
    day: date
    requests: int
    cached_requests: int
    bytes: int
    cached_bytes: int
    page_views: int
    visitors: int


@dataclass(frozen=True)
class SearchRow:
    day: date
    dimension: str
    key: str
    clicks: int
    impressions: int
    position: float


def _date_ranges(start: date, end: date, days: int) -> list[tuple[date, date]]:
    ranges = []
    while start <= end:
        last = min(end, start + timedelta(days=days - 1))
        ranges.append((start, last))
        start = last + timedelta(days=1)
    return ranges


def _cloudflare_days(body: dict, token: str) -> list[CloudflareDay]:
    if body.get("errors"):
        raise _safe(f"Cloudflare GraphQL error: {_error_detail(body) or 'unknown error'}", [token])
    try:
        zones = body["data"]["viewer"]["zones"]
        if not zones:
            raise AnalyticsError("Cloudflare found no zone with CLOUDFLARE_ZONE_ID that this token can read")
        return [
            CloudflareDay(
                day=date.fromisoformat(g["dimensions"]["date"]),
                requests=_count(g["sum"]["requests"]),
                cached_requests=_count(g["sum"]["cachedRequests"]),
                bytes=_count(g["sum"]["bytes"]),
                cached_bytes=_count(g["sum"]["cachedBytes"]),
                page_views=_count(g["sum"]["pageViews"]),
                visitors=_count(g["uniq"]["uniques"]),
            )
            for g in zones[0]["httpRequests1dGroups"]
        ]
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        raise AnalyticsError("Cloudflare returned data in an unexpected shape") from None


def fetch_cloudflare(settings: config.Settings, start: date, end: date) -> list[CloudflareDay]:
    token = settings.cloudflare_api_token
    days = []
    for first, last in _date_ranges(start, end, CLOUDFLARE_MAX_DAYS):
        body = _post(
            "Cloudflare API",
            f"{settings.cloudflare_api_url}/graphql",
            json.dumps({"query": CLOUDFLARE_QUERY % {"zone": settings.cloudflare_zone_id, "start": first.isoformat(), "end": last.isoformat()}}).encode(),
            {"authorization": f"Bearer {token}", "content-type": "application/json"},
            secrets=[token],
        )
        days.extend(_cloudflare_days(body, token))
    return days


@dataclass(frozen=True)
class _ServiceAccount:
    email: str
    private_key: str
    token_uri: str


def _service_account(path) -> _ServiceAccount:
    error = AnalyticsError("GSC_CREDENTIALS_FILE is not a readable service account JSON key")
    try:
        key = json.loads(path.read_bytes())
        account = _ServiceAccount(key["client_email"], key["private_key"], key["token_uri"])
    except (OSError, ValueError, KeyError, TypeError):
        raise error from None
    if not all(isinstance(v, str) and v for v in (account.email, account.private_key, account.token_uri)):
        raise error
    u = urlsplit(account.token_uri)
    if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost", "::1")):
        raise AnalyticsError("token_uri in GSC_CREDENTIALS_FILE must be an HTTPS URL")
    return account


def _google_access_token(settings: config.Settings) -> str:
    account = _service_account(settings.gsc_credentials_file)
    now = int(time.time())
    try:
        assertion = jwt.encode(
            {"iss": account.email, "scope": GSC_SCOPE, "aud": account.token_uri, "iat": now, "exp": now + 3600},
            account.private_key,
            algorithm="RS256",
        )
    except (ValueError, TypeError, jwt.PyJWTError):
        raise AnalyticsError("The private key in GSC_CREDENTIALS_FILE could not sign a token") from None
    body = _post(
        "Google token endpoint",
        account.token_uri,
        urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}).encode(),
        {"content-type": "application/x-www-form-urlencoded"},
        secrets=[assertion],
    )
    token = body.get("access_token")
    if not isinstance(token, str) or not token:
        raise AnalyticsError("Google token endpoint returned no access token")
    return token


def _search_rows(body: dict, dimension: str) -> list[SearchRow]:
    try:
        return [
            SearchRow(
                day=date.fromisoformat(r["keys"][0]),
                dimension=dimension,
                key=r["keys"][1] if dimension != "total" else "",
                clicks=_count(r["clicks"]),
                impressions=_count(r["impressions"]),
                position=float(r["position"]),
            )
            for r in body.get("rows", [])
            if dimension == "total" or r["keys"][1]
        ]
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        raise AnalyticsError("Search Console returned data in an unexpected shape") from None


def fetch_search_console(settings: config.Settings, start: date, end: date) -> list[SearchRow]:
    token = _google_access_token(settings)
    url = f"{settings.gsc_api_url}/webmasters/v3/sites/{quote(settings.gsc_site_url, safe='')}/searchAnalytics/query"
    rows: list[SearchRow] = []
    for dimension, dimensions in (("total", ["date"]), ("query", ["date", "query"]), ("page", ["date", "page"])):
        start_row = 0
        while True:
            body = _post(
                "Search Console API",
                url,
                json.dumps(
                    {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": dimensions, "rowLimit": GSC_ROW_LIMIT, "startRow": start_row}
                ).encode(),
                {"authorization": f"Bearer {token}", "content-type": "application/json"},
                secrets=[token],
            )
            page = _search_rows(body, dimension)
            rows.extend(page)
            if len(page) < GSC_ROW_LIMIT:
                break
            start_row += GSC_ROW_LIMIT
    return rows


# --- Storage ---


def _store_traffic(session: Session, start: date, end: date, rows: list[CloudflareDay], now: datetime) -> None:
    if not rows:
        return
    stmt = insert(TrafficDay).values([{**vars(r), "fetched_at": now} for r in rows])
    columns = [c for c in (*vars(rows[0]), "fetched_at") if c != "day"]
    session.execute(stmt.on_conflict_do_update(index_elements=[TrafficDay.day], set_={c: stmt.excluded[c] for c in columns}))


def _store_search(session: Session, start: date, end: date, rows: list[SearchRow], now: datetime) -> None:
    # Replaces the whole range, so a query that no longer shows up for a day
    # does not linger from an earlier fetch.
    session.execute(delete(SearchDay).where(SearchDay.day.between(start, end)))
    unique = {(r.day, r.dimension, r.key): vars(r) for r in rows}
    values = list(unique.values())
    # PostgreSQL takes at most 65535 parameters per statement.
    for i in range(0, len(values), INSERT_BATCH):
        session.execute(insert(SearchDay).values(values[i : i + INSERT_BATCH]))


# --- Sources ---


@dataclass(frozen=True)
class Source:
    name: str
    configured: Callable[[config.Settings], bool]
    # Days fetched on the first sync.
    backfill_days: int
    # Days before the last successful sync that are fetched again, because the
    # source may still change them.
    refetch_days: int
    fetch: Callable[[config.Settings, date, date], list]
    store: Callable[[Session, date, date, list, datetime], None]

    def window(self, synced_at: datetime | None, today: date) -> tuple[date, date]:
        earliest = today - timedelta(days=self.backfill_days - 1)
        if synced_at is None:
            return earliest, today
        return max(earliest, synced_at.astimezone(UTC).date() - timedelta(days=self.refetch_days)), today


SOURCES = (
    Source(
        name="cloudflare",
        configured=lambda s: s.cloudflare_api_token is not None,
        backfill_days=30,
        refetch_days=2,
        fetch=fetch_cloudflare,
        store=_store_traffic,
    ),
    # Search Console data lands 2-3 days late and keeps changing for a while.
    Source(
        name="search_console",
        configured=lambda s: s.gsc_site_url is not None,
        backfill_days=90,
        refetch_days=9,
        fetch=fetch_search_console,
        store=_store_search,
    ),
)


@dataclass(frozen=True)
class SourceStatus:
    source: str
    configured: bool
    synced_at: datetime | None
    attempted_at: datetime | None
    error: str | None
    stale: bool


def status(session: Session, now: datetime) -> list[SourceStatus]:
    settings = config.settings
    stored = {r.source: r for r in session.scalars(select(AnalyticsSource))}
    result = []
    for source in SOURCES:
        row = stored.get(source.name)
        configured = source.configured(settings)
        synced_at = row.synced_at if row else None
        result.append(
            SourceStatus(
                source=source.name,
                configured=configured,
                synced_at=synced_at,
                attempted_at=row.attempted_at if row else None,
                error=row.error if row else None,
                stale=configured
                and (synced_at is None or now - synced_at >= STALE)
                and not (row and row.error and row.attempted_at and now - row.attempted_at < RETRY_AFTER),
            )
        )
    return result


def _record(session: Session, name: str, now: datetime, error: str | None) -> None:
    values = {"source": name, "attempted_at": now, "error": error}
    if error is None:
        values["synced_at"] = now
    stmt = insert(AnalyticsSource).values(values)
    session.execute(stmt.on_conflict_do_update(index_elements=[AnalyticsSource.source], set_={k: v for k, v in values.items() if k != "source"}))


def sync(session: Session, now: datetime, force: bool = False) -> list[SourceStatus]:
    """Fetches every configured source that is stale (or all of them with
    `force`) and returns the status afterwards. Skips, returning the status,
    when another sync is running."""
    with advisory_lock(LOCK_KEY) as acquired:
        if not acquired:
            return status(session, now)
        settings = config.settings
        today = now.astimezone(UTC).date()
        for source, current in zip(SOURCES, status(session, now), strict=True):
            if not current.configured or not (force or current.stale):
                continue
            start, end = source.window(current.synced_at, today)
            try:
                rows = source.fetch(settings, start, end)
                source.store(session, start, end, rows, now)
                _record(session, source.name, now, None)
                session.commit()
                log.info("synced %s: %d rows for %s..%s", source.name, len(rows), start, end)
            except (AnalyticsError, SQLAlchemyError) as e:
                session.rollback()
                message = str(e) if isinstance(e, AnalyticsError) else "Storing the data failed; see the CMS log"
                if not isinstance(e, AnalyticsError):
                    log.exception("storing %s data failed", source.name)
                _record(session, source.name, now, message)
                session.commit()
                log.warning("sync of %s failed: %s", source.name, e)
    return status(session, now)


# --- Report ---


@dataclass(frozen=True)
class TrafficDayOut:
    day: date
    requests: int
    page_views: int
    visitors: int
    bytes: int


@dataclass(frozen=True)
class TrafficTotals:
    requests: int
    page_views: int
    # A sum of each day's unique IPs, so a visitor who comes back on two days counts twice.
    visitors: int
    bytes: int
    cache_hit_ratio: float | None


@dataclass(frozen=True)
class SearchDayOut:
    day: date
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


@dataclass(frozen=True)
class SearchTotals:
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


@dataclass(frozen=True)
class SearchItem:
    key: str
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


@dataclass(frozen=True)
class Report:
    start: date
    end: date
    sources: list[SourceStatus]
    traffic: list[TrafficDayOut]
    traffic_totals: TrafficTotals
    search: list[SearchDayOut]
    search_totals: SearchTotals
    top_queries: list[SearchItem]
    top_pages: list[SearchItem]


def _ratio(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def _weighted_position():
    """Average position over rows, weighted by impressions as Search Console does."""
    impressions = func.sum(SearchDay.impressions)
    return case((impressions > 0, func.sum(SearchDay.position * SearchDay.impressions) / impressions), else_=None)


def _top(session: Session, dimension: str, start: date, end: date) -> list[SearchItem]:
    clicks, impressions = func.sum(SearchDay.clicks), func.sum(SearchDay.impressions)
    rows = session.execute(
        select(SearchDay.key, clicks, impressions, _weighted_position())
        .where(SearchDay.dimension == dimension, SearchDay.day.between(start, end))
        .group_by(SearchDay.key)
        .order_by(clicks.desc(), impressions.desc(), SearchDay.key)
        .limit(TOP)
    )
    return [SearchItem(key, int(c), int(i), _ratio(c, i), p) for key, c, i, p in rows]


def report(session: Session, days: int, now: datetime) -> Report:
    end = now.astimezone(UTC).date()
    start = end - timedelta(days=days - 1)
    traffic = session.scalars(select(TrafficDay).where(TrafficDay.day.between(start, end)).order_by(TrafficDay.day)).all()
    requests = sum(d.requests for d in traffic)
    totals = session.scalars(select(SearchDay).where(SearchDay.dimension == "total", SearchDay.day.between(start, end)).order_by(SearchDay.day)).all()
    clicks, impressions = sum(r.clicks for r in totals), sum(r.impressions for r in totals)
    weighted = sum(r.position * r.impressions for r in totals)
    return Report(
        start=start,
        end=end,
        sources=status(session, now),
        traffic=[TrafficDayOut(r.day, r.requests, r.page_views, r.visitors, r.bytes) for r in traffic],
        traffic_totals=TrafficTotals(
            requests=requests,
            page_views=sum(d.page_views for d in traffic),
            visitors=sum(d.visitors for d in traffic),
            bytes=sum(d.bytes for d in traffic),
            cache_hit_ratio=_ratio(sum(d.cached_requests for d in traffic), requests),
        ),
        search=[SearchDayOut(r.day, r.clicks, r.impressions, _ratio(r.clicks, r.impressions), r.position if r.impressions else None) for r in totals],
        search_totals=SearchTotals(clicks, impressions, _ratio(clicks, impressions), weighted / impressions if impressions else None),
        top_queries=_top(session, "query", start, end),
        top_pages=_top(session, "page", start, end),
    )
