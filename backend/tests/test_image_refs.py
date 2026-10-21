import json
from pathlib import Path

import pytest

from blog import images

CASES = json.loads((Path(__file__).parents[2] / "frontend/test-fixtures/image-refs.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_image_refs_match_the_shared_fixture(case):
    assert sorted(images.refs(case["markdown"])) == case["refs"]
