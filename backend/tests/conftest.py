import os

import pytest

if "TEST_DATABASE_URL" not in os.environ:
    pytest.exit("Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database.", returncode=2)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import bindparam, text  # noqa: E402
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402

from blog import auth  # noqa: E402
from blog.api import app  # noqa: E402
from blog.db import SessionLocal, engine  # noqa: E402

ADMIN_PASSWORD = "correct horse battery staple"
# Production cost makes every sign-in take about 0.1 s; hashes record their own
# cost, so a cheaper one only speeds the tests up.
auth._SCRYPT["n"] = 2**10
# The address the CMS is served on (docs/local-setup.md); the API refuses other hosts.
BASE_URL = "http://127.0.0.1:8000"


@pytest.fixture(scope="session", autouse=True)
def schema():
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(scope="session")
def profile_seed(schema):
    with engine.connect() as conn:
        return conn.execute(text("SELECT content FROM profile")).scalar_one()


@pytest.fixture(autouse=True)
def clean_tables(profile_seed):
    yield
    with engine.begin() as conn:
        # The single profile row is part of the schema, so it is reset rather than truncated.
        conn.execute(
            text("UPDATE profile SET revision = 1, content = :seed, updated_at = now()").bindparams(
                bindparam("seed", profile_seed, type_=JSONB)
            )
        )
        conn.execute(
            text(
                "TRUNCATE articles, topics, tags, series, images, retired_doc_ids, admin_credentials, admin_sessions, releases"
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
    return TestClient(app, base_url=BASE_URL)


@pytest.fixture
def client(admin):
    return sign_in(TestClient(app, base_url=BASE_URL))
