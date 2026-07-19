import json
from pathlib import Path

import pytest

from app.models import Design

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_design_dict(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text())


@pytest.fixture
def g1_design_dict() -> dict:
    return load_design_dict("g1_branch_office.json")


@pytest.fixture
def g4_design_dict() -> dict:
    return load_design_dict("g4_smb_simple.json")


@pytest.fixture
def g1_design(g1_design_dict) -> Design:
    return Design.model_validate(g1_design_dict)


@pytest.fixture
def g4_design(g4_design_dict) -> Design:
    return Design.model_validate(g4_design_dict)
