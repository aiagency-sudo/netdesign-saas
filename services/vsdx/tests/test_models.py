"""design-schema.json is the contract of record (per CLAUDE.md). app/models.py
hand-mirrors its enums; this suite fails the moment the two drift apart —
the same role schema-drift-guard.test.ts plays on the TypeScript side."""

import json
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from app.models import Design, DeviceRole, LinkKind, SegmentPurpose, VendorHint

DESIGN_SCHEMA_PATH = Path(__file__).parents[3] / "packages" / "schema" / "src" / "design-schema.json"


@pytest.fixture(scope="module")
def design_schema_json() -> dict:
    return json.loads(DESIGN_SCHEMA_PATH.read_text())


def test_device_role_enum_matches_design_schema(design_schema_json):
    expected = set(design_schema_json["properties"]["devices"]["items"]["properties"]["role"]["enum"])
    assert set(get_args(DeviceRole)) == expected


def test_vendor_hint_enum_matches_design_schema(design_schema_json):
    expected = set(design_schema_json["properties"]["devices"]["items"]["properties"]["vendorHint"]["enum"])
    assert set(get_args(VendorHint)) == expected


def test_link_kind_enum_matches_design_schema(design_schema_json):
    expected = set(design_schema_json["properties"]["links"]["items"]["properties"]["kind"]["enum"])
    assert set(get_args(LinkKind)) == expected


def test_segment_purpose_enum_matches_design_schema(design_schema_json):
    expected = set(design_schema_json["properties"]["segments"]["items"]["properties"]["purpose"]["enum"])
    assert set(get_args(SegmentPurpose)) == expected


def test_top_level_required_fields_match_design_schema(design_schema_json):
    assert set(design_schema_json["required"]) == {"version", "meta", "devices", "links", "segments"}


class TestDesignValidation:
    def test_accepts_a_valid_design(self, g1_design_dict):
        design = Design.model_validate(g1_design_dict)
        assert design.meta.name == "G1 Branch Office"
        assert len(design.devices) == 5

    def test_rejects_wrong_version(self, g1_design_dict):
        g1_design_dict["version"] = "2.0"
        with pytest.raises(ValidationError):
            Design.model_validate(g1_design_dict)

    def test_rejects_empty_devices(self, g1_design_dict):
        g1_design_dict["devices"] = []
        with pytest.raises(ValidationError):
            Design.model_validate(g1_design_dict)

    def test_rejects_unknown_device_role(self, g1_design_dict):
        g1_design_dict["devices"][0]["role"] = "quantum-router"
        with pytest.raises(ValidationError):
            Design.model_validate(g1_design_dict)

    def test_rejects_bad_device_id_pattern(self, g1_design_dict):
        g1_design_dict["devices"][0]["id"] = "RTR_01"
        with pytest.raises(ValidationError):
            Design.model_validate(g1_design_dict)
