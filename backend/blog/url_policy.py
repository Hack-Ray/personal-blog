"""Which link and image URLs an article or the profile intro may contain.

Copy of frontend/src/content/url-policy.ts (cms/src/url-policy.ts is the other
copy), so a publish or profile save through the API is refused for the URLs the
site build would refuse. All three are tested against
frontend/test-fixtures/url-policy.json.
"""

import re

from markdown_it import MarkdownIt

# The defaults turn javascript: and data: links into plain text and
# percent-encode the rest, so the URL the browser would see never shows up.
_MD = MarkdownIt("commonmark")
_MD.validateLink = lambda url: True
_MD.normalizeLink = lambda url: url

_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)

# markdown-it decodes the references CommonMark defines. The browser also
# decodes "&#106avascript:" (no semicolon) and "java&colon;", so decode again:
# over-blocking is the safe side. Named references that decode to ASCII are the
# only ones that can spell a scheme.
_NAMED = {
    "tab": "\t", "newline": "\n", "colon": ":", "sol": "/", "bsol": "\\", "amp": "&", "period": ".", "num": "#",
    "quest": "?", "percnt": "%", "plus": "+", "lowbar": "_", "commat": "@", "semi": ";", "equals": "=",
}


def _code_point(value: int) -> str:
    return chr(min(value, 0x10FFFF))


def _decode(url: str) -> str:
    url = re.sub(r"&#x([0-9a-f]+);?", lambda m: _code_point(int(m[1], 16)), url, flags=re.IGNORECASE)
    url = re.sub(r"&#([0-9]+);?", lambda m: _code_point(int(m[1])), url)
    return re.sub(r"&([a-z]+);", lambda m: _NAMED.get(m[1].lower(), m[0]), url, flags=re.IGNORECASE)


# Browsers drop tabs and newlines inside a URL and ignore leading control
# characters and spaces, so "java\tscript:" still runs as javascript:.
def _normalize(url: str) -> str:
    return re.sub(r"^[\x00-\x20]+", "", re.sub(r"[\t\n\r]", "", _decode(url)))


def allowed_link(href: str) -> bool:
    """https:, http:, mailto:, #anchors and relative paths."""
    url = _normalize(href)
    if re.match(r"(https?|mailto):", url, re.IGNORECASE):
        return True
    # "//host", "\\host" and "/\\host" all leave the site.
    return not _SCHEME.match(url) and not re.match(r"[/\\]{2}", url)


def allowed_image(src: str) -> bool:
    """Snapshot images (images/…) and https: images."""
    url = _normalize(src)
    return url.startswith("images/") or url[:6].lower() == "https:"


def blocked(markdown: str) -> list[str]:
    """Link and image URLs in the Markdown that the site will not output."""
    found: list[str] = []
    for block in _MD.parse(markdown):
        for token in block.children or []:
            if token.type == "link_open":
                href = str(token.attrGet("href"))
                if not allowed_link(href):
                    found.append(href)
            elif token.type == "image":
                src = str(token.attrGet("src"))
                if not allowed_image(src):
                    found.append(src)
    return found
