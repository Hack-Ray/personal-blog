"""Checks the token Cloudflare Access adds to each request it lets through (BE-026)."""

from functools import cache

import jwt

from blog import config

HEADER = "cf-access-jwt-assertion"
# Allows for clock skew between Cloudflare and this host.
LEEWAY = 60


class Refused(Exception):
    pass


class KeysUnavailable(Exception):
    pass


@cache
def _keys(team_domain: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{team_domain}/cdn-cgi/access/certs", cache_keys=True, timeout=10)


def verify(token: str | None) -> str:
    """Returns the signed-in email. Blocks while Cloudflare's signing keys are fetched."""
    access = config.settings.access
    if not token:
        raise Refused("no Cloudflare Access token")
    try:
        if jwt.get_unverified_header(token).get("alg") != "RS256":
            raise Refused("token is not signed with RS256")
        key = _keys(access.team_domain).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=access.audience,
            issuer=f"https://{access.team_domain}",
            leeway=LEEWAY,
            options={"require": ["exp", "iat", "aud", "iss"]},
        )
    # A key set that is unreachable, not JSON, or without usable keys is
    # Cloudflare's side failing, not a bad token.
    except (jwt.PyJWKClientConnectionError, jwt.PyJWKSetError, ValueError) as e:
        raise KeysUnavailable(str(e)) from e
    except (jwt.PyJWKClientError, jwt.InvalidTokenError) as e:
        raise Refused(str(e)) from e
    email = claims.get("email")
    if not isinstance(email, str) or email.lower() not in access.emails:
        raise Refused("email is not on CLOUDFLARE_ACCESS_EMAILS")
    return email.lower()
