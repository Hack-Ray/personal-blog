import html
import json
from pathlib import Path

import pytest

from blog import url_policy

CASES = json.loads((Path(__file__).parents[2] / "frontend/test-fixtures/url-policy.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_blocked_urls_match_the_shared_fixture(case):
    # marked keeps character references raw and markdown-it decodes them.
    assert url_policy.blocked(case["markdown"]) == [html.unescape(u) for u in case["blocked"]]
