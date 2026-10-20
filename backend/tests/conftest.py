import os

import pytest

if "TEST_DATABASE_URL" not in os.environ:
    pytest.exit("Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database.", returncode=2)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from blog import auth  # noqa: E402
from blog.api import app  # noqa: E402
from blog.db import SessionLocal, engine  # noqa: E402

ADMIN_PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="session", autouse=True)
def schema():
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE articles, topics, tags, images, retired_doc_ids, admin_credentials, admin_sessions, releases"
                " RESTART IDENTITY CASCADE"
            )
        )
    auth.throttle = auth.Throttle()


@pytest.fixture(scope="session")
def admin_hash():
    return auth.hash_password(ADMIN_PASSWORD)


@pytest.fixture
def admin(admin_hash):
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO admin_credentials (id, password_hash) VALUES (1, :h)"), {"h": admin_hash})


def sign_in(c: TestClient) -> TestClient:
    r = c.post("/api/session", json={"password": ADMIN_PASSWORD})
    assert r.status_code == 204, r.text
    return c


@pytest.fixture
def anon(admin):
    return TestClient(app)


@pytest.fixture
def client(admin):
    return sign_in(TestClient(app))
