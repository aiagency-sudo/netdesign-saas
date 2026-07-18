import zipfile
from io import BytesIO

import pytest

from app.models import Design
from app.structural_validator import validate_vsdx_structure
from app.vsdx_builder import VsdxBuildError, build_vsdx_bytes, renderable_links


class TestGoldenScenarios:
    """G1 (branch-office) and G4 (smb-flat) — the same fixtures used for the
    design-engine composer's snapshot tests on the TypeScript side."""

    @pytest.mark.parametrize("design_fixture", ["g1_design", "g4_design"])
    def test_produces_a_valid_zip_with_required_parts(self, design_fixture, request):
        design: Design = request.getfixturevalue(design_fixture)
        data = build_vsdx_bytes(design)

        zf = zipfile.ZipFile(BytesIO(data))
        names = set(zf.namelist())
        assert "[Content_Types].xml" in names
        assert "visio/pages/page1.xml" in names

    @pytest.mark.parametrize("design_fixture", ["g1_design", "g4_design"])
    def test_passes_structural_validation(self, design_fixture, request):
        design: Design = request.getfixturevalue(design_fixture)
        data = build_vsdx_bytes(design)

        result = validate_vsdx_structure(data, design)
        assert result.ok, result.errors

    def test_g1_has_one_shape_per_device_and_one_connector_per_renderable_link(self, g1_design):
        data = build_vsdx_bytes(g1_design)
        links = renderable_links(g1_design)
        assert len(links) == 5  # all 5 G1 links are device-to-device

        zf = zipfile.ZipFile(BytesIO(data))
        import xml.etree.ElementTree as ET

        import vsdx

        root = ET.fromstring(zf.read("visio/pages/page1.xml"))
        shapes = root.find(f"{vsdx.namespace}Shapes").findall(f"{vsdx.namespace}Shape")
        assert len(shapes) == len(g1_design.devices) + len(links)

    def test_reopening_the_output_with_vsdx_itself_round_trips(self, g1_design, tmp_path):
        import vsdx

        data = build_vsdx_bytes(g1_design)
        out_path = tmp_path / "g1.vsdx"
        out_path.write_bytes(data)

        with vsdx.VisioFile(str(out_path)) as vis:
            page = vis.get_page(0)
            assert len(page.child_shapes) == len(g1_design.devices) + len(renderable_links(g1_design))
            device_shapes = [s for s in page.child_shapes if s.data_properties]
            assert len(device_shapes) == len(g1_design.devices)
            for shape in device_shapes:
                props = {label: dp.value for label, dp in shape.data_properties.items()}
                assert props["Device ID"] in {d.id for d in g1_design.devices}


class TestLinkHandling:
    def test_skips_a_link_to_a_device_outside_the_design(self, g4_design_dict):
        g4_design_dict["links"].append({"a": "fw-01", "b": "isp-edge", "kind": "wan"})
        design = Design.model_validate(g4_design_dict)

        links = renderable_links(design)
        assert len(links) == 2  # the original 2 G4 links, not the isp-edge one

        data = build_vsdx_bytes(design)
        result = validate_vsdx_structure(data, design)
        assert result.ok, result.errors

    def test_strips_the_interface_suffix_from_link_endpoints(self, g4_design_dict):
        g4_design_dict["links"] = [{"a": "fw-01:eth0", "b": "rtr-01:eth1", "kind": "ethernet"}]
        design = Design.model_validate(g4_design_dict)

        data = build_vsdx_bytes(design)
        result = validate_vsdx_structure(data, design)
        assert result.ok, result.errors


class TestErrorHandling:
    def test_rejects_duplicate_device_ids(self, g4_design_dict):
        g4_design_dict["devices"].append(dict(g4_design_dict["devices"][0]))
        design = Design.model_validate(g4_design_dict)

        with pytest.raises(VsdxBuildError, match="duplicate device ids"):
            build_vsdx_bytes(design)
