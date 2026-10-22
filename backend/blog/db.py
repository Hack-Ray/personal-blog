from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from blog.config import settings


class Base(DeclarativeBase):
    pass


def database_url() -> str:
    return settings.database_url


# A managed database (RDS) closes idle connections; check before use and
# replace connections well before such limits. For TLS, add
# ?sslmode=verify-full to DATABASE_URL.
engine = create_engine(database_url(), pool_pre_ping=True, pool_recycle=1800)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


@contextmanager
def advisory_lock(key: int) -> Iterator[bool]:
    """Holds a PostgreSQL advisory lock, across requests and processes, if
    no one else does; yields whether it was acquired."""
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        acquired = bool(conn.scalar(select(func.pg_try_advisory_lock(key))))
        try:
            yield acquired
        finally:
            if acquired:
                conn.scalar(select(func.pg_advisory_unlock(key)))
