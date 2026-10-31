import logging
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from blog import analytics, articles, auth, backups, cloudflare_access, config, images, infra, profile, release, release_jobs, taxa
from blog.db import SessionLocal, get_session
from blog.models import Article, ArticleState, Profile, PublishedVersion, Release, ReleaseJob, ReleaseStatus, WorkingDraft

# Logs go to stdout for the host (or CloudWatch) to collect.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)
audit = logging.getLogger("blog.audit")
audit.setLevel(logging.INFO)

docs = {} if config.settings.enable_docs else {"docs_url": None, "redoc_url": None, "openapi_url": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    worker = release_jobs.Worker()
    worker.start()
    backup = backups.Scheduler(config.settings.backup_every_hours)
    backup.start()
    try:
        yield
    finally:
        await run_in_threadpool(backup.close)
        await run_in_threadpool(worker.close)


app = FastAPI(title="Personal Blog CMS", lifespan=lifespan, **docs)

PUBLIC_API = {"/api/session"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _signed_in(token: str | None) -> bool:
    with SessionLocal() as session:
        return auth.is_signed_in(session, token)


async def _is_admin(request: Request) -> bool:
    if config.settings.access:
        return getattr(request.state, "access_email", None) is not None
    return await run_in_threadpool(_signed_in, request.cookies.get(config.settings.session_cookie))


@app.middleware("http")
async def require_admin(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        origin = request.headers.get("origin")
        # Behind an HTTPS proxy the request itself may look like http://, so the
        # configured origin wins when there is one.
        expected = config.settings.cms_origin or f"{request.url.scheme}://{request.url.netloc}"
        if request.method in UNSAFE_METHODS and origin and origin != expected:
            return JSONResponse({"detail": "cross-origin request refused"}, status_code=status.HTTP_403_FORBIDDEN)
        if path not in PUBLIC_API and not await _is_admin(request):
            return JSONResponse({"detail": "sign in required"}, status_code=status.HTTP_401_UNAUTHORIZED)
    return await call_next(request)


# The CMS only loads its own scripts, so script injected through an article
# preview cannot run even if the renderer misses it. Shiki colours code with
# style attributes, and previews may show https: images.
ADMIN_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)
SECURITY_HEADERS = {
    "Content-Security-Policy": ADMIN_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    # Only once the CMS is on HTTPS, which COOKIE_SECURE says.
    **({"Strict-Transport-Security": "max-age=31536000"} if config.settings.cookie_secure else {}),
}


# Added after require_admin so it runs before it. Every path but /healthz
# needs the token, so neither the CMS's files nor its API answer a request
# that did not come through Cloudflare Access.
@app.middleware("http")
async def require_cloudflare_access(request: Request, call_next):
    if config.settings.access is None or request.url.path == "/healthz":
        return await call_next(request)
    try:
        request.state.access_email = await run_in_threadpool(cloudflare_access.verify, request.headers.get(cloudflare_access.HEADER))
    except cloudflare_access.KeysUnavailable as e:
        log.error("cannot fetch Cloudflare Access signing keys: %s", e)
        return JSONResponse({"detail": "cannot reach Cloudflare Access to check the sign-in; try again"}, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except cloudflare_access.Refused:
        return JSONResponse({"detail": "Cloudflare Access sign-in required"}, status_code=status.HTTP_403_FORBIDDEN)
    return await call_next(request)


# Added after the sign-in checks so their refusals get the headers and the
# audit line too. /docs is left alone: its page loads Swagger UI from a CDN.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith(("/admin", "/api/")) or path == "/":
        response.headers.update(SECURITY_HEADERS)
    # Every change, sign-in attempts included, leaves one line; bodies are not logged.
    if path.startswith("/api/") and request.method in UNSAFE_METHODS:
        client = request.client.host if request.client else "-"
        user = f" user={getattr(request.state, 'access_email', '-')}" if config.settings.access else ""
        audit.info("method=%s path=%s status=%d client=%s%s", request.method, path, response.status_code, client, user)
    return response


# Added last so it runs first. A web page that rebinds its own domain to
# 127.0.0.1 reaches the CMS with that domain as Host; refusing it keeps such a
# page from trying passwords or locking sign-in. /healthz answers any host so
# a load balancer or monitor can reach it by address.
@app.middleware("http")
async def trusted_host(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0]
    if request.url.path != "/healthz" and host not in config.settings.allowed_hosts:
        return PlainTextResponse("Invalid host header", status_code=status.HTTP_400_BAD_REQUEST)
    return await call_next(request)


@app.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    with SessionLocal() as session:
        session.execute(text("SELECT 1"))
    return {"status": "ok"}


SessionDep = Annotated[Session, Depends(get_session)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class TaxonBody(BaseModel):
    slug: Slug
    name: Name


Excerpt = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
ImageId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}\.[a-z]+$", max_length=80)]


class DraftBody(BaseModel):
    title: str
    topic: TaxonBody
    tags: list[TaxonBody] = []
    markdown: str = ""
    excerpt: Excerpt = ""
    cover: ImageId | None = None
    series: TaxonBody | None = None

    def content(self) -> articles.DraftContent:
        return articles.DraftContent(
            title=self.title,
            topic=articles.Taxon(self.topic.slug, self.topic.name),
            tags=[articles.Taxon(t.slug, t.name) for t in self.tags],
            markdown=self.markdown,
            excerpt=self.excerpt,
            cover=self.cover,
            series=articles.Taxon(self.series.slug, self.series.name) if self.series else None,
        )


class RevisedDraftBody(DraftBody):
    base_revision: int = Field(ge=1)


class DraftOut(BaseModel):
    doc_id: str
    state: ArticleState
    revision: int
    title: str
    topic: TaxonBody
    tags: list[TaxonBody]
    markdown: str
    excerpt: str
    cover: str | None
    series: TaxonBody | None
    updated_at: datetime
    slug: str | None

    @classmethod
    def of(cls, d: WorkingDraft) -> "DraftOut":
        return cls(
            doc_id=d.article.doc_id,
            slug=d.article.slug,
            state=d.article.state,
            revision=d.revision,
            title=d.title,
            topic=TaxonBody(slug=d.topic.slug, name=d.topic.name),
            tags=[TaxonBody(slug=t.slug, name=t.name) for t in d.tags],
            markdown=d.markdown,
            excerpt=d.excerpt,
            cover=d.cover,
            series=TaxonBody(slug=d.series.slug, name=d.series.name) if d.series else None,
            updated_at=d.updated_at,
        )


class PublishedOut(BaseModel):
    doc_id: str
    version: int
    revision: int
    published_at: datetime


class ArticleOut(BaseModel):
    doc_id: str
    state: ArticleState
    title: str
    pinned: bool
    slug: str | None
    deleted_at: datetime | None
    purge_after: datetime | None

    @classmethod
    def of(cls, a: Article) -> "ArticleOut":
        return cls(
            doc_id=a.doc_id,
            slug=a.slug,
            state=a.state,
            title=a.draft.title,
            pinned=a.pinned_at is not None,
            deleted_at=a.deleted_at,
            purge_after=a.deleted_at + articles.PENDING_DELETION_RETENTION if a.deleted_at else None,
        )


class SignInBody(BaseModel):
    password: str = Field(max_length=auth.MAX_PASSWORD_LENGTH)


class SessionOut(BaseModel):
    signed_in: bool
    method: Literal["password", "cloudflare"]


@app.get("/api/session")
def get_session_status(request: Request, session: SessionDep) -> SessionOut:
    if config.settings.access:
        return SessionOut(signed_in=True, method="cloudflare")
    return SessionOut(signed_in=auth.is_signed_in(session, request.cookies.get(config.settings.session_cookie)), method="password")


def _password_sign_in_only(detail: str) -> None:
    if config.settings.access:
        raise HTTPException(status.HTTP_409_CONFLICT, detail)


CLOUDFLARE_SIGN_OUT = "this CMS signs in through Cloudflare Access; sign out at /cdn-cgi/access/logout and revoke sessions in Cloudflare Zero Trust"


@app.post("/api/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_in(body: SignInBody, request: Request, response: Response, session: SessionDep) -> None:
    _password_sign_in_only("password sign-in is off; this CMS signs in through Cloudflare Access")
    # Behind a proxy listed in FORWARDED_ALLOW_IPS, uvicorn puts the original client here.
    client = request.client.host if request.client else "unknown"
    try:
        token = auth.sign_in(session, body.password, client)
    except auth.TooManyAttempts as e:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(e), headers={"Retry-After": str(e.retry_after)}) from e
    except auth.Busy as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e), headers={"Retry-After": "5"}) from e
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong password")
    response.set_cookie(
        config.settings.session_cookie,
        token,
        max_age=int(auth.SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=config.settings.cookie_secure,
        path="/",
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(config.settings.session_cookie, path="/", secure=config.settings.cookie_secure, httponly=True, samesite="strict")


@app.delete("/api/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(request: Request, response: Response, session: SessionDep) -> None:
    _password_sign_in_only(CLOUDFLARE_SIGN_OUT)
    auth.sign_out(session, request.cookies.get(config.settings.session_cookie))
    _clear_cookie(response)


@app.delete("/api/sessions", status_code=status.HTTP_204_NO_CONTENT)
def sign_out_everywhere(response: Response, session: SessionDep) -> None:
    """Signs out every browser, this one included."""
    _password_sign_in_only(CLOUDFLARE_SIGN_OUT)
    auth.sign_out_everywhere(session)
    _clear_cookie(response)


@app.exception_handler(articles.ArticleNotFound)
def _not_found(_, exc: articles.ArticleNotFound) -> JSONResponse:
    return JSONResponse({"detail": f"article {exc} not found"}, status_code=status.HTTP_404_NOT_FOUND)


@app.exception_handler(articles.RevisionConflict)
def _conflict(_, exc: articles.RevisionConflict) -> JSONResponse:
    return JSONResponse(
        {"detail": "draft changed since base_revision; reload it", "current_revision": exc.current_revision},
        status_code=status.HTTP_409_CONFLICT,
    )


@app.exception_handler(articles.InvalidTransition)
def _invalid_transition(_, exc: articles.InvalidTransition) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "state": exc.state}, status_code=status.HTTP_409_CONFLICT)


@app.get("/api/articles")
def list_articles(session: SessionDep, state: ArticleState | None = None) -> list[ArticleOut]:
    return [ArticleOut.of(a) for a in articles.list_articles(session, state)]


@app.post("/api/articles", status_code=status.HTTP_201_CREATED)
def create_article(body: DraftBody, session: SessionDep) -> DraftOut:
    return DraftOut.of(articles.create_article(session, body.content()))


@app.get("/api/articles/{doc_id}/draft")
def get_draft(doc_id: str, session: SessionDep) -> DraftOut:
    return DraftOut.of(articles.get_article(session, doc_id).draft)


@app.put("/api/articles/{doc_id}/draft")
def save_draft(doc_id: str, body: RevisedDraftBody, session: SessionDep) -> DraftOut:
    return DraftOut.of(articles.save_draft(session, doc_id, body.base_revision, body.content()))


@app.post("/api/articles/{doc_id}/publish", status_code=status.HTTP_201_CREATED)
def publish(doc_id: str, body: RevisedDraftBody, session: SessionDep) -> PublishedOut:
    try:
        v: PublishedVersion = articles.publish(session, doc_id, body.base_revision, body.content())
    except articles.NotPublishable as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    return PublishedOut(doc_id=doc_id, version=v.version, revision=body.base_revision + 1, published_at=v.published_at)


class PinnedBody(BaseModel):
    pinned: bool


@app.put("/api/articles/{doc_id}/pinned")
def set_pinned(doc_id: str, body: PinnedBody, session: SessionDep) -> ArticleOut:
    return ArticleOut.of(articles.set_pinned(session, doc_id, body.pinned))


class SlugBody(BaseModel):
    slug: str | None


@app.exception_handler(articles.SlugTaken)
def _slug_taken(_, exc: articles.SlugTaken) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "suggestion": exc.suggestion}, status_code=status.HTTP_409_CONFLICT)


@app.put("/api/articles/{doc_id}/slug")
def set_slug(doc_id: str, body: SlugBody, session: SessionDep) -> ArticleOut:
    try:
        return ArticleOut.of(articles.set_slug(session, doc_id, body.slug))
    except articles.InvalidSlug as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e


@app.post("/api/articles/{doc_id}/archive")
def archive(doc_id: str, session: SessionDep) -> ArticleOut:
    return ArticleOut.of(articles.archive(session, doc_id))


@app.delete("/api/articles/{doc_id}")
def delete(doc_id: str, session: SessionDep) -> ArticleOut:
    """Moves the article to Pending Deletion for 30 days."""
    return ArticleOut.of(articles.delete(session, doc_id))


@app.post("/api/articles/{doc_id}/restore")
def restore(doc_id: str, session: SessionDep) -> ArticleOut:
    return ArticleOut.of(articles.restore(session, doc_id))


@app.post("/api/articles/{doc_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge(doc_id: str, session: SessionDep) -> None:
    articles.purge(session, doc_id)


class SnapshotOut(BaseModel):
    id: int
    revision: int
    markdown: str
    created_at: datetime


class RestoreBody(BaseModel):
    base_revision: int = Field(ge=1)


@app.get("/api/articles/{doc_id}/snapshots")
def list_snapshots(doc_id: str, session: SessionDep) -> list[SnapshotOut]:
    return [SnapshotOut(id=s.id, revision=s.revision, markdown=s.markdown, created_at=s.created_at) for s in articles.list_snapshots(session, doc_id)]


@app.post("/api/articles/{doc_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(doc_id: str, snapshot_id: int, body: RestoreBody, session: SessionDep) -> DraftOut:
    try:
        return DraftOut.of(articles.restore_snapshot(session, doc_id, snapshot_id, body.base_revision))
    except articles.SnapshotNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "snapshot not found") from e


class ReleaseOut(BaseModel):
    id: str
    content_commit: str
    status: ReleaseStatus
    detail: str | None
    run_url: str | None
    created_at: datetime
    updated_at: datetime
    dispatched_at: datetime | None

    @classmethod
    def of(cls, r: Release) -> "ReleaseOut":
        return cls(**{f: getattr(r, f) for f in cls.model_fields})


@app.post("/api/releases/refresh")
def refresh_releases(session: SessionDep) -> list[ReleaseOut]:
    """Asks GitHub how the dispatched releases are doing, then lists them."""
    release.refresh_in_flight(session, release.deployer_from_env())
    return [ReleaseOut.of(r) for r in release.recent(session)]


class ReleaseJobBody(BaseModel):
    action: str = "create"
    release_id: str | None = None


class ReleaseJobOut(BaseModel):
    id: str
    action: str
    requested_release_id: str | None
    release_id: str | None
    status: str
    detail: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, job: ReleaseJob) -> "ReleaseJobOut":
        return cls(**{field: getattr(job, field) for field in cls.model_fields})


@app.post("/api/release-jobs", status_code=status.HTTP_202_ACCEPTED)
def create_release_job(body: ReleaseJobBody, session: SessionDep) -> ReleaseJobOut:
    try:
        return ReleaseJobOut.of(release_jobs.submit(session, body.action, body.release_id))
    except release.ReleaseError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error


@app.get("/api/release-jobs")
def list_release_jobs(session: SessionDep) -> list[ReleaseJobOut]:
    return [ReleaseJobOut.of(job) for job in release_jobs.recent(session)]


class TokenOut(BaseModel):
    configured: bool
    expires_at: datetime | None


@app.get("/api/github-token")
def github_token() -> TokenOut:
    """The CMS's own CMS_GITHUB_TOKEN, so the releases page can warn before it expires.

    A GitHub App's installation tokens are short-lived and renewed by the CMS,
    so there is nothing to ask GitHub about."""
    if config.settings.github_auth == "app":
        return TokenOut(configured=False, expires_at=None)
    deployer = release.deployer_from_env()
    if not isinstance(deployer, release.GitHubActions):
        return TokenOut(configured=False, expires_at=None)
    try:
        return TokenOut(configured=True, expires_at=deployer.token_expires_at())
    except release.ReleaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e


class IncidentOut(BaseModel):
    name: str
    url: str


class GitHubStatusOut(BaseModel):
    incidents: list[IncidentOut]


@app.get("/api/github-status")
def github_status() -> GitHubStatusOut:
    """Open GitHub incidents that can hold up a deploy. The page's CSP keeps the browser off githubstatus.com, so the CMS asks."""
    try:
        incidents = release.github_incidents()
    except release.ReleaseError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return GitHubStatusOut(incidents=[IncidentOut(name=i.name, url=i.url) for i in incidents])


class SourceStatusOut(BaseModel, from_attributes=True):
    source: Literal["cloudflare", "search_console"]
    configured: bool
    synced_at: datetime | None
    attempted_at: datetime | None
    error: str | None
    stale: bool


class TrafficDayOut(BaseModel, from_attributes=True):
    day: date
    requests: int
    page_views: int
    visitors: int
    bytes: int


class TrafficTotalsOut(BaseModel, from_attributes=True):
    requests: int
    page_views: int
    visitors: int
    bytes: int
    cache_hit_ratio: float | None


class SearchDayOut(BaseModel, from_attributes=True):
    day: date
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


class SearchTotalsOut(BaseModel, from_attributes=True):
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


class SearchItemOut(BaseModel, from_attributes=True):
    key: str
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


class AnalyticsOut(BaseModel, from_attributes=True):
    start: date
    end: date
    sources: list[SourceStatusOut]
    traffic: list[TrafficDayOut]
    traffic_totals: TrafficTotalsOut
    search: list[SearchDayOut]
    search_totals: SearchTotalsOut
    top_queries: list[SearchItemOut]
    top_pages: list[SearchItemOut]


class SyncBody(BaseModel):
    force: bool = False


@app.get("/api/analytics")
def get_analytics(session: SessionDep, days: int = 28) -> AnalyticsOut:
    """Stored traffic and search data for the last `days` UTC days; never calls Cloudflare or Google."""
    if days not in analytics.RANGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"days must be one of {', '.join(map(str, analytics.RANGES))}")
    return AnalyticsOut.model_validate(analytics.report(session, days, datetime.now(UTC)))


@app.post("/api/analytics/sync")
def sync_analytics(session: SessionDep, body: SyncBody | None = None) -> list[SourceStatusOut]:
    """Fetches the configured sources whose data is stale, or all of them with `force`."""
    statuses = analytics.sync(session, datetime.now(UTC), force=body.force if body else False)
    return [SourceStatusOut.model_validate(s) for s in statuses]


class HostDayOut(BaseModel, from_attributes=True):
    day: date
    cpu_average: float | None
    cpu_maximum: float | None
    network_in: int
    network_out: int
    status_check_failures: int


class BackupOut(BaseModel, from_attributes=True):
    key: str
    size: int
    modified: datetime


class InfrastructureOut(BaseModel, from_attributes=True):
    configured: bool
    start: date
    end: date
    fetched_at: datetime | None
    error: str | None
    instance_id: str | None
    host: list[HostDayOut]
    bucket: str | None
    bucket_bytes: int | None
    bucket_objects: int | None
    latest_backup: BackupOut | None


@app.get("/api/infrastructure")
def get_infrastructure(days: int = 28, refresh: bool = False) -> InfrastructureOut:
    """The CMS host's CloudWatch metrics and its backup bucket, cached for a few minutes."""
    if days not in analytics.RANGES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"days must be one of {', '.join(map(str, analytics.RANGES))}")
    return InfrastructureOut.model_validate(infra.report(days, datetime.now(UTC), refresh))


class ProfileBody(BaseModel):
    revision: int = Field(ge=1)
    content: profile.ProfileContent


class ProfileOut(BaseModel):
    revision: int
    content: profile.ProfileContent
    updated_at: datetime

    @classmethod
    def of(cls, p: Profile) -> "ProfileOut":
        return cls(revision=p.revision, content=profile.ProfileContent.model_validate(p.content), updated_at=p.updated_at)


@app.exception_handler(profile.ProfileConflict)
def _profile_conflict(_, exc: profile.ProfileConflict) -> JSONResponse:
    return JSONResponse(
        {"detail": "profile changed since revision; reload it", "current_revision": exc.current_revision},
        status_code=status.HTTP_409_CONFLICT,
    )


@app.get("/api/profile", response_model_exclude_none=True)
def get_profile(session: SessionDep) -> ProfileOut:
    return ProfileOut.of(profile.get(session))


@app.put("/api/profile", response_model_exclude_none=True)
def save_profile(body: ProfileBody, session: SessionDep) -> ProfileOut:
    try:
        return ProfileOut.of(profile.save(session, body.revision, body.content))
    except profile.MissingImages as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e


class TaxonUsageOut(BaseModel):
    slug: str
    name: str
    articles: int
    in_use: bool


class RenameBody(BaseModel):
    name: Name


class MergeBody(BaseModel):
    into: Slug


@app.exception_handler(taxa.TaxonNotFound)
def _taxon_not_found(_, exc: taxa.TaxonNotFound) -> JSONResponse:
    return JSONResponse({"detail": f"{exc} not found"}, status_code=status.HTTP_404_NOT_FOUND)


@app.get("/api/taxa")
def list_taxa(session: SessionDep) -> dict[taxa.Kind, list[TaxonUsageOut]]:
    return {kind: [TaxonUsageOut(**vars(u)) for u in taxa.usage(session, kind)] for kind in taxa.Kind}


@app.put("/api/taxa/{kind}/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def rename_taxon(kind: taxa.Kind, slug: str, body: RenameBody, session: SessionDep) -> None:
    taxa.rename(session, kind, slug, body.name)


@app.post("/api/taxa/{kind}/{slug}/merge", status_code=status.HTTP_204_NO_CONTENT)
def merge_taxon(kind: taxa.Kind, slug: str, body: MergeBody, session: SessionDep) -> None:
    try:
        taxa.merge(session, kind, slug, body.into)
    except taxa.InvalidMerge as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e


@app.delete("/api/taxa/{kind}/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_taxon(kind: taxa.Kind, slug: str, session: SessionDep) -> None:
    try:
        taxa.remove(session, kind, slug)
    except taxa.TaxonInUse as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


class ImageOut(BaseModel):
    id: str
    markdown: str


# A plain def runs in the threadpool, so decoding and encoding the image does
# not block other requests.
@app.post("/api/images", status_code=status.HTTP_201_CREATED)
def upload_image(file: UploadFile, session: SessionDep) -> ImageOut:
    data = file.file.read(images.MAX_BYTES + 1)
    try:
        image = images.store(session, data)
    except images.ImageTooLarge as e:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(e)) from e
    except images.UnsupportedImage as e:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(e)) from e
    return ImageOut(id=image.id, markdown=f"![](images/{image.id})")


@app.get("/api/images/{image_id}")
def get_image(image_id: str, session: SessionDep) -> Response:
    found = images.load(session, image_id)
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "image not found")
    image, data = found
    return Response(data, media_type=image.content_type, headers={"cache-control": "private, max-age=31536000, immutable"})


if config.settings.cms_dist.is_dir():
    app.mount("/admin", StaticFiles(directory=config.settings.cms_dist, html=True), name="cms")

    @app.get("/", include_in_schema=False)
    def _root() -> RedirectResponse:
        return RedirectResponse("/admin/")
