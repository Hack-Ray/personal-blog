import os

import pytest

if "TEST_DATABASE_URL" not in os.environ:
    pytest.exit("Set TEST_DATABASE_URL to an empty, disposable PostgreSQL database.", returncode=2)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from blog.api import app  # noqa: E402
from blog.db import engine  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def schema():
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    command.downgrade(config, "base")
    command.upgrade(config, "head")


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE articles, topics, tags, images, retired_doc_ids RESTART IDENTITY CASCADE"))


@pytest.fixture
def client():
    return TestClient(app)
