import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.orm import Session

from blog import articles, auth, exporter, images, profile, release, retention
from blog.db import SessionLocal, get_session
from blog.models import Article, ArticleState, Profile, PublishedVersion, Release, ReleaseStatus, WorkingDraft


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    with SessionLocal() as session:
        now = datetime.now(UTC)
        articles.purge_expired(session, now)
        retention.cleanup_versions(session)
        images.collect_garbage(session, now)
    yield


app = FastAPI(title="Personal Blog CMS", lifespan=lifespan)

# Set COOKIE_SECURE=1 once the CMS is served over HTTPS.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE") == "1"
PUBLIC_API = {"/api/session"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def require_admin(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS and origin and origin != f"{request.url.scheme}://{request.url.netloc}":
            return JSONResponse({"detail": "cross-origin request refused"}, status_code=status.HTTP_403_FORBIDDEN)
        if path not in PUBLIC_API:
            with SessionLocal() as session:
                if not auth.is_signed_in(session, request.cookies.get(auth.SESSION_COOKIE)):
                    return JSONResponse({"detail": "sign in required"}, status_code=status.HTTP_401_UNAUTHORIZED)
    return await call_next(request)


# Added last so it runs first. A web page that rebinds its own domain to
# 127.0.0.1 reaches the CMS with that domain as Host; refusing it keeps such a
# page from trying passwords or locking sign-in.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

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

    @classmethod
    def of(cls, d: WorkingDraft) -> "DraftOut":
        return cls(
            doc_id=d.article.doc_id,
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
    deleted_at: datetime | None
    purge_after: datetime | None

    @classmethod
    def of(cls, a: Article) -> "ArticleOut":
        return cls(
            doc_id=a.doc_id,
            state=a.state,
            title=a.draft.title,
            pinned=a.pinned_at is not None,
            deleted_at=a.deleted_at,
            purge_after=a.deleted_at + articles.PENDING_DELETION_RETENTION if a.deleted_at else None,
        )


class SignInBody(BaseModel):
    password: str


class SessionOut(BaseModel):
    signed_in: bool


@app.get("/api/session")
def get_session_status(session: SessionDep, cms_session: Annotated[str | None, Cookie()] = None) -> SessionOut:
    return SessionOut(signed_in=auth.is_signed_in(session, cms_session))


@app.post("/api/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_in(body: SignInBody, response: Response, session: SessionDep) -> None:
    if auth.throttle.locked():
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many failed attempts; try again in 15 minutes")
    token = auth.sign_in(session, body.password)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong password")
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=int(auth.SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=COOKIE_SECURE,
        path="/",
    )


@app.delete("/api/session", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, session: SessionDep, cms_session: Annotated[str | None, Cookie()] = None) -> None:
    auth.sign_out(session, cms_session)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")


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
    return [
        SnapshotOut(id=s.id, revision=s.revision, markdown=s.markdown, created_at=s.created_at)
        for s in articles.list_snapshots(session, doc_id)
    ]


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

    @classmethod
    def of(cls, r: Release) -> "ReleaseOut":
        return cls(**{f: getattr(r, f) for f in cls.model_fields})


class CreatedRelease(BaseModel):
    release: ReleaseOut | None


def _content_repo() -> Path:
    repo = release.content_repo_from_env()
    if repo is None or not (repo / ".git").exists():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "CONTENT_REPO_DIR must point at a clone of personal-blog-content")
    return repo


@app.get("/api/releases")
def list_releases(session: SessionDep) -> list[ReleaseOut]:
    return [ReleaseOut.of(r) for r in release.recent(session, release.deployer_from_env())]


@app.post("/api/releases")
def create_release(session: SessionDep) -> CreatedRelease:
    """Exports the published content and starts the site deploy; `release`
    is null when nothing changed since the last export."""
    try:
        created = release.create(session, _content_repo(), release.deployer_from_env())
    except exporter.ExportError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    return CreatedRelease(release=ReleaseOut.of(created) if created else None)


@app.post("/api/releases/{release_id}/retry")
def retry_release(release_id: str, session: SessionDep) -> ReleaseOut:
    try:
        return ReleaseOut.of(release.retry(session, release_id, _content_repo(), release.deployer_from_env()))
    except release.ReleaseError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


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
    return ProfileOut.of(profile.save(session, body.revision, body.content))


class ImageOut(BaseModel):
    id: str
    markdown: str


@app.post("/api/images", status_code=status.HTTP_201_CREATED)
async def upload_image(file: UploadFile, session: SessionDep) -> ImageOut:
    data = await file.read(images.MAX_BYTES + 1)
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


CMS_DIST = Path(os.environ.get("CMS_DIST", Path(__file__).resolve().parents[2] / "cms" / "dist"))

if CMS_DIST.is_dir():
    app.mount("/admin", StaticFiles(directory=CMS_DIST, html=True), name="cms")

    @app.get("/", include_in_schema=False)
    def _root() -> RedirectResponse:
        return RedirectResponse("/admin/")
