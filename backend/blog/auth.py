"""CMS administrator sign-in (Baseline 5.1, section 10 rule 7)."""

import argparse
import base64
import getpass
import hashlib
import hmac
import math
import secrets
import threading
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from blog.db import SessionLocal
from blog.models import AdminCredential, AdminSession, SignInAttempt

SESSION_TTL = timedelta(days=3)
IDLE_TIMEOUT = timedelta(days=1)
# last_seen_at is written at most this often, not on every request.
SEEN_RESOLUTION = timedelta(minutes=5)
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 1024
# A client may fail this many times before it has to wait; each further
# failure doubles the wait, up to MAX_BACKOFF.
MAX_FAILURES = 5
BACKOFF = timedelta(seconds=30)
MAX_BACKOFF = timedelta(minutes=15)
# A client that has not tried for this long starts again from zero.
ATTEMPTS_RESET = timedelta(hours=1)
# Each check takes about 32 MiB for scrypt; more wait or are refused.
CONCURRENT_CHECKS = 2
CHECK_WAIT = 10

_SCRYPT = {"n": 2**15, "r": 8, "p": 1, "maxmem": 64 * 1024 * 1024}


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    _, n, r, p, salt, digest = stored.split("$")
    candidate = hashlib.scrypt(
        password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32, maxmem=_SCRYPT["maxmem"]
    )
    return hmac.compare_digest(candidate, base64.b64decode(digest))


def set_password(session: Session, password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    hashed = hash_password(password)
    session.execute(
        insert(AdminCredential)
        .values(id=1, password_hash=hashed)
        .on_conflict_do_update(index_elements=["id"], set_={"password_hash": hashed, "updated_at": datetime.now(UTC)})
    )
    # A new password signs out every existing session.
    session.execute(delete(AdminSession))
    session.commit()


class TooManyAttempts(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(f"too many failed attempts; try again in {retry_after} seconds")
        self.retry_after = retry_after


class Busy(Exception):
    pass


_checks = threading.BoundedSemaphore(CONCURRENT_CHECKS)


def _count_attempt(session: Session, client: str, now: datetime) -> None:
    """Counts the attempt before the password is checked, so concurrent
    guesses cannot slip past the limit. Raises while the client must wait."""
    session.execute(delete(SignInAttempt).where(SignInAttempt.last_attempt_at < now - ATTEMPTS_RESET))
    # One statement creates or locks the row, so a parallel successful
    # sign-in deleting it cannot leave nothing to lock.
    attempt = session.scalars(
        insert(SignInAttempt)
        .values(client=client, failures=0, last_attempt_at=now)
        .on_conflict_do_update(index_elements=["client"], set_={"client": client})
        .returning(SignInAttempt),
        execution_options={"populate_existing": True},
    ).one()
    if attempt.blocked_until and attempt.blocked_until > now:
        session.commit()
        raise TooManyAttempts(math.ceil((attempt.blocked_until - now).total_seconds()))
    attempt.failures += 1
    attempt.last_attempt_at = now
    if attempt.failures >= MAX_FAILURES:
        attempt.blocked_until = now + min(MAX_BACKOFF, BACKOFF * 2 ** (attempt.failures - MAX_FAILURES))
    session.commit()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def sign_in(session: Session, password: str, client: str) -> str | None:
    """Returns a new session token, or None for a wrong or missing password.
    Raises TooManyAttempts while `client` must wait, and Busy when too many
    checks are running."""
    now = datetime.now(UTC)
    _count_attempt(session, client, now)
    stored = session.scalar(select(AdminCredential.password_hash).where(AdminCredential.id == 1))
    # Hand the connection back while waiting for a check slot.
    session.rollback()
    if not _checks.acquire(timeout=CHECK_WAIT):
        raise Busy("too many sign-in attempts at once; try again shortly")
    try:
        ok = stored is not None and verify_password(password, stored)
    finally:
        _checks.release()
    if not ok:
        return None
    token = secrets.token_urlsafe(32)
    session.execute(delete(SignInAttempt).where(SignInAttempt.client == client))
    session.execute(delete(AdminSession).where(AdminSession.expires_at <= now))
    session.add(AdminSession(token_hash=_token_hash(token), expires_at=now + SESSION_TTL, last_seen_at=now))
    session.commit()
    return token


def is_signed_in(session: Session, token: str | None) -> bool:
    """A session ends SESSION_TTL after sign-in, or after IDLE_TIMEOUT unused."""
    if not token:
        return False
    found = session.scalars(select(AdminSession).where(AdminSession.token_hash == _token_hash(token))).one_or_none()
    now = datetime.now(UTC)
    if found is None or found.expires_at <= now or found.last_seen_at <= now - IDLE_TIMEOUT:
        return False
    if found.last_seen_at <= now - SEEN_RESOLUTION:
        session.execute(update(AdminSession).where(AdminSession.token_hash == found.token_hash).values(last_seen_at=now))
        session.commit()
    return True


def sign_out(session: Session, token: str | None) -> None:
    if token:
        session.execute(delete(AdminSession).where(AdminSession.token_hash == _token_hash(token)))
        session.commit()


def sign_out_everywhere(session: Session) -> None:
    session.execute(delete(AdminSession))
    session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Set the CMS administrator password.")
    parser.parse_args()
    password = getpass.getpass("New admin password: ")
    if password != getpass.getpass("Repeat: "):
        raise SystemExit("Passwords do not match.")
    with SessionLocal() as session:
        try:
            set_password(session, password)
        except ValueError as e:
            raise SystemExit(str(e)) from e
    print("Admin password set. Existing sessions were signed out.")


if __name__ == "__main__":
    main()
