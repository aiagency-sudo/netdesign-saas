import zipfile
from io import BytesIO

import pytest

from app.models import Design
from app.structural_validator import validate_vsdx_structure
from app.vsdx_builder import (
    VsdxBuildError,
    _port_label_position,
    build_vsdx_bytes,
    link_interface_names,
    renderable_links,
)


def _expected_shape_count(design: Design) -> int:
    links = renderable_links(design)
    port_labels = sum(1 for link in links for interface in link_interface_names(link) if interface)
    return len(design.devices) + len(links) + port_labels


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

    def test_g1_has_one_shape_per_device_plus_one_connector_and_two_port_labels_per_renderable_link(self, g1_design):
        data = build_vsdx_bytes(g1_design)
        links = renderable_links(g1_design)
        assert len(links) == 5  # all 5 G1 links are device-to-device

        zf = zipfile.ZipFile(BytesIO(data))
        import xml.etree.ElementTree as ET

        import vsdx

        root = ET.fromstring(zf.read("visio/pages/page1.xml"))
        shapes = root.find(f"{vsdx.namespace}Shapes").findall(f"{vsdx.namespace}Shape")
        assert len(shapes) == _expected_shape_count(g1_design)

    def test_reopening_the_output_with_vsdx_itself_round_trips(self, g1_design, tmp_path):
        import vsdx

        data = build_vsdx_bytes(g1_design)
        out_path = tmp_path / "g1.vsdx"
        out_path.write_bytes(data)

        with vsdx.VisioFile(str(out_path)) as vis:
            page = vis.get_page(0)
            assert len(page.child_shapes) == _expected_shape_count(g1_design)
            device_shapes = [s for s in page.child_shapes if s.data_properties]
            assert len(device_shapes) == len(g1_design.devices)
            for shape in device_shapes:
                props = {label: dp.value for label, dp in shape.data_properties.items()}
                assert props["Device ID"] in {d.id for d in g1_design.devices}

            # every interface name on a G1 link should be a real, visible port-label shape.
            expected_port_labels = {
                interface
                for link in renderable_links(g1_design)
                for interface in link_interface_names(link)
                if interface
            }
            actual_texts = {s.text for s in page.child_shapes if s.text}
            assert expected_port_labels <= actual_texts


class TestPortLabelPosition:
    def test_sits_offset_from_the_near_shape_toward_the_far_shape(self):
        x, y = _port_label_position((0.0, 0.0), (10.0, 0.0))
        assert x == pytest.approx(0.9)  # PORT_LABEL_OFFSET_IN, along the +x direction
        assert y == pytest.approx(0.0)

    def test_never_overshoots_past_the_midpoint_on_a_short_link(self):
        # shapes only 1 inch apart — a full 0.9in offset would nearly reach the far shape,
        # so the label should clamp to the midpoint (45% of the way there) instead.
        x, _y = _port_label_position((0.0, 0.0), (1.0, 0.0))
        assert x == pytest.approx(0.45)

    def test_handles_coincident_shapes_without_dividing_by_zero(self):
        assert _port_label_position((3.0, 3.0), (3.0, 3.0)) == (3.0, 3.0)


class TestPortLabels:
    def test_a_link_without_interface_names_gets_no_port_label_shapes(self, g4_design_dict):
        g4_design_dict["links"] = [{"a": "fw-01", "b": "rtr-01", "kind": "ethernet"}]  # no ":interface" suffix
        design = Design.model_validate(g4_design_dict)

        data = build_vsdx_bytes(design)
        result = validate_vsdx_structure(data, design)
        assert result.ok, result.errors

        import xml.etree.ElementTree as ET

        import vsdx

        zf = zipfile.ZipFile(BytesIO(data))
        root = ET.fromstring(zf.read("visio/pages/page1.xml"))
        shapes = root.find(f"{vsdx.namespace}Shapes").findall(f"{vsdx.namespace}Shape")
        assert len(shapes) == len(design.devices) + 1  # 2 devices + 1 connector, zero port labels

    def test_a_link_with_only_one_named_interface_gets_exactly_one_port_label(self, g4_design_dict):
        g4_design_dict["links"] = [{"a": "fw-01:eth0/0", "b": "rtr-01", "kind": "ethernet"}]
        design = Design.model_validate(g4_design_dict)

        data = build_vsdx_bytes(design)
        result = validate_vsdx_structure(data, design)
        assert result.ok, result.errors

        import xml.etree.ElementTree as ET

        import vsdx

        zf = zipfile.ZipFile(BytesIO(data))
        root = ET.fromstring(zf.read("visio/pages/page1.xml"))
        shapes = root.find(f"{vsdx.namespace}Shapes").findall(f"{vsdx.namespace}Shape")
        assert len(shapes) == len(design.devices) + 1 + 1  # 2 devices + 1 connector + 1 port label
        texts = {(s.find(f"{vsdx.namespace}Text").text or "").strip() for s in shapes}
        assert "eth0/0" in texts


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
