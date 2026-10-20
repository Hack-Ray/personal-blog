from datetime import datetime
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.orm import Session

from blog import articles
from blog.db import get_session
from blog.models import PublishedVersion, WorkingDraft

app = FastAPI(title="Personal Blog CMS")

SessionDep = Annotated[Session, Depends(get_session)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class TaxonBody(BaseModel):
    slug: Slug
    name: Name


class DraftBody(BaseModel):
    title: str
    topic: TaxonBody
    tags: list[TaxonBody] = []
    markdown: str = ""

    def content(self) -> articles.DraftContent:
        return articles.DraftContent(
            title=self.title,
            topic=articles.Taxon(self.topic.slug, self.topic.name),
            tags=[articles.Taxon(t.slug, t.name) for t in self.tags],
            markdown=self.markdown,
        )


class RevisedDraftBody(DraftBody):
    base_revision: int = Field(ge=1)


class DraftOut(BaseModel):
    doc_id: str
    revision: int
    title: str
    topic: TaxonBody
    tags: list[TaxonBody]
    markdown: str
    updated_at: datetime

    @classmethod
    def of(cls, d: WorkingDraft) -> "DraftOut":
        return cls(
            doc_id=d.article.doc_id,
            revision=d.revision,
            title=d.title,
            topic=TaxonBody(slug=d.topic.slug, name=d.topic.name),
            tags=[TaxonBody(slug=t.slug, name=t.name) for t in d.tags],
            markdown=d.markdown,
            updated_at=d.updated_at,
        )


class PublishedOut(BaseModel):
    doc_id: str
    version: int
    revision: int
    published_at: datetime


@app.exception_handler(articles.ArticleNotFound)
def _not_found(_, exc: articles.ArticleNotFound) -> JSONResponse:
    return JSONResponse({"detail": f"article {exc} not found"}, status_code=status.HTTP_404_NOT_FOUND)


@app.exception_handler(articles.RevisionConflict)
def _conflict(_, exc: articles.RevisionConflict) -> JSONResponse:
    return JSONResponse(
        {"detail": "draft changed since base_revision; reload it", "current_revision": exc.current_revision},
        status_code=status.HTTP_409_CONFLICT,
    )


@app.post("/api/articles", status_code=status.HTTP_201_CREATED)
def create_article(body: DraftBody, session: SessionDep) -> DraftOut:
    return DraftOut.of(articles.create_article(session, body.content()))


@app.get("/api/articles/{doc_id}/draft")
def get_draft(doc_id: str, session: SessionDep) -> DraftOut:
    return DraftOut.of(articles.get_draft(session, doc_id))


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
