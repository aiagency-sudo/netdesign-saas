import io
import xml.etree.ElementTree as ET
import zipfile

import vsdx

from app.structural_validator import validate_vsdx_structure
from app.vsdx_builder import build_vsdx_bytes

NS = vsdx.namespace


def test_rejects_bytes_that_arent_a_zip(g1_design):
    result = validate_vsdx_structure(b"not a zip file at all", g1_design)
    assert not result.ok
    assert any("not a valid zip archive" in e for e in result.errors)


def test_rejects_a_zip_missing_required_parts(g1_design):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("hello.txt", "not a vsdx")
    result = validate_vsdx_structure(buf.getvalue(), g1_design)
    assert not result.ok
    assert any("Missing required OOXML part" in e for e in result.errors)


def test_catches_a_missing_device_shape(g1_design):
    """Simulates a builder regression: delete one device's shape from an otherwise-valid
    output and confirm the validator flags it against the (unmodified) source design."""
    data = build_vsdx_bytes(g1_design)
    zf = zipfile.ZipFile(io.BytesIO(data))
    page_xml = zf.read("visio/pages/page1.xml")

    root = ET.fromstring(page_xml)
    shapes_el = root.find(f"{NS}Shapes")
    first_shape = shapes_el.find(f"{NS}Shape")
    shapes_el.remove(first_shape)

    tampered = _rewrite_zip_entry(data, "visio/pages/page1.xml", ET.tostring(root))
    result = validate_vsdx_structure(tampered, g1_design)

    assert not result.ok
    assert any("Expected" in e and "shapes" in e for e in result.errors)


def test_catches_wrong_shape_data_on_a_device(g1_design):
    """Simulates shape data getting attached to the wrong device — the label/id counts
    would still match, so only the per-device Shape Data cross-check can catch this."""
    data = build_vsdx_bytes(g1_design)
    zf = zipfile.ZipFile(io.BytesIO(data))
    page_xml = zf.read("visio/pages/page1.xml")

    root = ET.fromstring(page_xml)
    shapes_el = root.find(f"{NS}Shapes")
    for shape in shapes_el.findall(f"{NS}Shape"):
        for row in shape.findall(f'{NS}Section[@N="Property"]/{NS}Row'):
            value_cell = row.find(f'{NS}Cell[@N="Value"]')
            label_cell = row.find(f'{NS}Cell[@N="Label"]')
            if label_cell is not None and label_cell.attrib.get("V") == "Role":
                value_cell.attrib["V"] = "totally-wrong-role"

    tampered = _rewrite_zip_entry(data, "visio/pages/page1.xml", ET.tostring(root))
    result = validate_vsdx_structure(tampered, g1_design)

    assert not result.ok
    assert any("Role" in e for e in result.errors)


def _rewrite_zip_entry(original_zip_bytes: bytes, entry_name: str, new_contents: bytes) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(original_zip_bytes))
    out_buf = io.BytesIO()
    with zipfile.ZipFile(out_buf, "w") as dst:
        for item in src.infolist():
            contents = new_contents if item.filename == entry_name else src.read(item.filename)
            dst.writestr(item, contents)
    return out_buf.getvalue()
