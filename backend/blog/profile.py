"""The About page profile, a single row exported as profile.json."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from blog import images, url_policy
from blog.models import Profile

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Line = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Paragraph = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
Url = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^(https://|mailto:)\S+$", max_length=2000)]


class Link(BaseModel):
    label: Title
    url: Url


class Experience(BaseModel):
    role: Title
    organization: Line = ""
    period: Line = ""
    description: Paragraph = ""


class Project(BaseModel):
    name: Title
    url: Url | None = None
    description: Paragraph = ""
    tags: list[Tag] = Field(default=[], max_length=20)


# Same default as DEFAULT_PROFILE in frontend/src/content/parse.ts.
DEFAULT_SITE_TITLE = "Personal Blog"


class Site(BaseModel):
    """The name and description in page titles, the site header and the RSS feed, and the footer text."""

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""
    # "" shows the default "© <year> <name>" on the public site.
    footer: Line = ""


class ProfileContent(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    headline: Line = ""
    intro: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)] = ""
    links: list[Link] = Field(default=[], max_length=50)
    experience: list[Experience] = Field(default=[], max_length=50)
    projects: list[Project] = Field(default=[], max_length=50)
    # Rows saved before the site fields existed have no "site" key and read as the default.
    site: Site = Field(default_factory=lambda: Site(title=DEFAULT_SITE_TITLE))

    @field_validator("intro")
    @classmethod
    def _intro_urls_allowed(cls, intro: str) -> str:
        if bad := url_policy.blocked(intro):
            raise ValueError(f"links or images not allowed: {', '.join(bad)}")
        return intro

    def public(self) -> dict:
        return self.model_dump(exclude_none=True)


class ProfileConflict(Exception):
    def __init__(self, current_revision: int):
        super().__init__(f"profile is at revision {current_revision}")
        self.current_revision = current_revision


class MissingImages(Exception):
    pass


def get(session: Session) -> Profile:
    return session.get_one(Profile, 1)


def save(session: Session, revision: int, content: ProfileContent) -> Profile:
    """Rejects a save based on any revision but the current one."""
    row = session.scalars(select(Profile).where(Profile.id == 1).with_for_update()).one()
    if row.revision != revision:
        raise ProfileConflict(row.revision)
    # Every release exports the profile, so a missing image would fail them all.
    if gone := images.missing(session, content.intro):
        raise MissingImages(f"images not found: {', '.join(sorted(gone))}")
    row.content = content.public()
    row.revision += 1
    row.updated_at = func.now()
    images.mark_referenced(session, content.intro)
    session.commit()
    session.refresh(row)
    return row
