"""CMS administrator sign-in (Baseline 5.1, section 10 rule 7)."""

import argparse
import base64
import getpass
import hashlib
import hmac
import secrets
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from blog.db import SessionLocal
from blog.models import AdminCredential, AdminSession

SESSION_TTL = timedelta(days=7)
MIN_PASSWORD_LENGTH = 12
MAX_FAILURES = 5
LOCKOUT = 15 * 60

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


class Throttle:
    """Refuses sign-in for 15 minutes after 5 consecutive failures. In memory,
    which is enough for one local process."""

    def __init__(self) -> None:
        self.failures = 0
        self.locked_until = 0.0

    def locked(self) -> bool:
        return time.monotonic() < self.locked_until

    def record(self, ok: bool) -> None:
        if ok:
            self.failures = 0
            return
        self.failures += 1
        if self.failures >= MAX_FAILURES:
            self.failures = 0
            self.locked_until = time.monotonic() + LOCKOUT


throttle = Throttle()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def sign_in(session: Session, password: str) -> str | None:
    """Returns a new session token, or None for a wrong or missing password."""
    stored = session.scalar(select(AdminCredential.password_hash).where(AdminCredential.id == 1))
    ok = stored is not None and verify_password(password, stored)
    throttle.record(ok)
    if not ok:
        return None
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    session.execute(delete(AdminSession).where(AdminSession.expires_at <= now))
    session.add(AdminSession(token_hash=_token_hash(token), expires_at=now + SESSION_TTL))
    session.commit()
    return token


def is_signed_in(session: Session, token: str | None) -> bool:
    if not token:
        return False
    expires_at = session.scalar(select(AdminSession.expires_at).where(AdminSession.token_hash == _token_hash(token)))
    return expires_at is not None and expires_at > datetime.now(UTC)


def sign_out(session: Session, token: str | None) -> None:
    if token:
        session.execute(delete(AdminSession).where(AdminSession.token_hash == _token_hash(token)))
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
