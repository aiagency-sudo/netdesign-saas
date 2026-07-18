import io
import re
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


def test_catches_a_duplicate_content_types_override(g1_design):
    """Regression test for the real bug that broke draw.io's importer: vsdx.Connect.create()
    used to append a fresh <Override> for the masters files on every call instead of once,
    producing multiple entries for the same PartName — invalid per the OPC spec even though
    vsdx's own parser didn't complain. build_vsdx_bytes() now dedupes this, but the validator
    should independently catch it if it ever creeps back in."""
    data = build_vsdx_bytes(g1_design)
    zf = zipfile.ZipFile(io.BytesIO(data))
    content_types_ns = "{http://schemas.openxmlformats.org/package/2006/content-types}"

    root = ET.fromstring(zf.read("[Content_Types].xml"))
    an_override = root.find(f"{content_types_ns}Override")
    duplicate = ET.fromstring(ET.tostring(an_override))
    root.append(duplicate)

    tampered = _rewrite_zip_entry(data, "[Content_Types].xml", ET.tostring(root))
    result = validate_vsdx_structure(tampered, g1_design)

    assert not result.ok
    assert any("Override" in e and "PartName" in e for e in result.errors)


def test_catches_a_duplicate_relationship(g1_design):
    data = build_vsdx_bytes(g1_design)
    zf = zipfile.ZipFile(io.BytesIO(data))
    relationships_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"

    root = ET.fromstring(zf.read("visio/_rels/document.xml.rels"))
    a_relationship = root.find(f"{relationships_ns}Relationship")
    duplicate = ET.fromstring(ET.tostring(a_relationship))
    duplicate.attrib["Id"] = "rIdDuplicate"
    root.append(duplicate)

    tampered = _rewrite_zip_entry(data, "visio/_rels/document.xml.rels", ET.tostring(root))
    result = validate_vsdx_structure(tampered, g1_design)

    assert not result.ok
    assert any("Relationship" in e and "Type/Target" in e for e in result.errors)


def test_g1_and_g4_outputs_have_no_duplicate_opc_metadata(g1_design, g4_design):
    """The actual bug report: G1 has 5 link connectors, which used to be enough to produce 6
    duplicate <Override>/<Relationship> entries for the same masters files. Confirm the real
    (non-tampered) builder output is clean for both golden scenarios."""
    for design in (g1_design, g4_design):
        result = validate_vsdx_structure(build_vsdx_bytes(design), design)
        assert result.ok, result.errors


def test_catches_a_generated_namespace_prefix(g1_design):
    """Regression test for the second real bug that broke draw.io's importer: vsdx never
    registers a default namespace, so any part it re-serializes gets Python's auto "ns0:"
    prefix (<ns0:PageContents> instead of <PageContents xmlns="...">), which silently breaks
    every one of draw.io's bare-string tag/attribute comparisons. build_vsdx_bytes() now
    normalizes this, but the validator should independently catch it if it ever creeps back.

    Simulates the bug by uniformly re-prefixing every tag in an otherwise-valid page1.xml —
    every element there shares the one Visio namespace, so this stays well-formed (unlike a
    partial find/replace, which would leave mismatched open/close tags)."""
    data = build_vsdx_bytes(g1_design)
    zf = zipfile.ZipFile(io.BytesIO(data))
    page_xml = zf.read("visio/pages/page1.xml").decode("utf-8")

    tampered_xml = page_xml.replace(
        'xmlns="http://schemas.microsoft.com/office/visio/2012/main"',
        'xmlns:ns0="http://schemas.microsoft.com/office/visio/2012/main"',
    )
    tampered_xml = re.sub(r"<(/?)([A-Za-z])", r"<\1ns0:\2", tampered_xml)

    tampered = _rewrite_zip_entry(data, "visio/pages/page1.xml", tampered_xml.encode("utf-8"))
    result = validate_vsdx_structure(tampered, g1_design)

    assert not result.ok
    assert any("nsN" in e and "page1.xml" in e for e in result.errors)


def test_g1_and_g4_outputs_have_no_generated_namespace_prefixes(g1_design, g4_design):
    for design in (g1_design, g4_design):
        result = validate_vsdx_structure(build_vsdx_bytes(design), design)
        assert result.ok, result.errors


def _rewrite_zip_entry(original_zip_bytes: bytes, entry_name: str, new_contents: bytes) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(original_zip_bytes))
    out_buf = io.BytesIO()
    with zipfile.ZipFile(out_buf, "w") as dst:
        for item in src.infolist():
            contents = new_contents if item.filename == entry_name else src.read(item.filename)
            dst.writestr(item, contents)
    return out_buf.getvalue()
