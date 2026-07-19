"""Structural validation of a rendered .vsdx: unzip it, confirm the OOXML
parts a Visio file needs are present, and cross-check the page's shape/
connector/shape-data content against the design JSON that produced it.

This is deliberately not a byte-for-byte "golden .vsdx" comparison — that's
tests/golden/*.vsdx territory per CLAUDE.md, for once real exports have been
eyeballed in actual Visio (the Session-4 weekend gate). This validator
catches structural regressions (a device silently missing its shape, a link
silently missing its connector, shape data with the wrong value) well before
that.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from dataclasses import dataclass, field

import vsdx

from app.models import Design, Link
from app.vsdx_builder import link_interface_names, renderable_links

NS = vsdx.namespace
CONTENT_TYPES_NS = "{http://schemas.openxmlformats.org/package/2006/content-types}"
RELATIONSHIPS_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

REQUIRED_PARTS = [
    "[Content_Types].xml",
    "_rels/.rels",
    "visio/document.xml",
    "visio/pages/page1.xml",
    "visio/pages/pages.xml",
    "visio/windows.xml",
]


@dataclass
class StructuralValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def validate_vsdx_structure(data: bytes, design: Design) -> StructuralValidationResult:
    errors: list[str] = []

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return StructuralValidationResult(ok=False, errors=["File is not a valid zip archive."])

    names = set(zf.namelist())
    for part in REQUIRED_PARTS:
        if part not in names:
            errors.append(f"Missing required OOXML part: {part}")

    if "visio/pages/page1.xml" not in names:
        errors.append("Cannot check shapes/connectors/shape-data: visio/pages/page1.xml is missing.")
        return StructuralValidationResult(ok=False, errors=errors)

    try:
        root = ET.fromstring(zf.read("visio/pages/page1.xml"))
    except ET.ParseError as exc:
        errors.append(f"visio/pages/page1.xml is not well-formed XML: {exc}")
        return StructuralValidationResult(ok=False, errors=errors)

    links = renderable_links(design)
    port_label_count = sum(1 for link in links for interface in link_interface_names(link) if interface)
    expected_shape_count = len(design.devices) + len(links) + port_label_count
    expected_connect_count = 2 * len(links)

    shapes_el = root.find(f"{NS}Shapes")
    shape_elements = shapes_el.findall(f"{NS}Shape") if shapes_el is not None else []
    if len(shape_elements) != expected_shape_count:
        errors.append(
            f"Expected {expected_shape_count} top-level shapes "
            f"({len(design.devices)} devices + {len(links)} connectors + {port_label_count} port labels), "
            f"found {len(shape_elements)}.",
        )

    connects_el = root.find(f"{NS}Connects")
    connect_elements = connects_el.findall(f"{NS}Connect") if connects_el is not None else []
    if len(connect_elements) != expected_connect_count:
        errors.append(
            f"Expected {expected_connect_count} <Connect> elements (2 per link), found {len(connect_elements)}.",
        )

    errors.extend(_check_device_shape_data(shape_elements, design))
    errors.extend(_check_port_labels_present(shape_elements, links))
    errors.extend(_check_opc_metadata_integrity(zf, names))
    errors.extend(_check_no_generated_namespace_prefixes(zf, names))

    return StructuralValidationResult(ok=len(errors) == 0, errors=errors)


GENERATED_PREFIX_PATTERN = re.compile(r"\bns\d+:")


def _check_no_generated_namespace_prefixes(zf: zipfile.ZipFile, names: set[str]) -> list[str]:
    """draw.io's importer matches tags/attributes as bare string literals (e.g.
    `child.tagName === "PageContents"`, `getElementsByTagName("Relationship")`). vsdx never
    calls ET.register_namespace(), so any part it re-serializes gets Python's auto-generated
    "ns0:"-style prefix instead of the default (unprefixed) namespace real Visio uses —
    which silently breaks every one of those comparisons even though vsdx's own parser
    doesn't care. See vsdx_builder._repackage / services/vsdx/README.md. Python reserves the
    `ns\\d+` prefix pattern exclusively for this auto-generation (register_namespace() itself
    rejects it), so a match here is unambiguous — not a false positive on legitimate content.
    """
    relevant = {
        name
        for name in names
        if name == "[Content_Types].xml"
        or name.endswith(".rels")
        or (name.startswith("visio/") and name.endswith(".xml") and "docProps" not in name)
    }
    errors: list[str] = []
    for name in sorted(relevant):
        text = zf.read(name).decode("utf-8", errors="replace")
        if GENERATED_PREFIX_PATTERN.search(text):
            errors.append(f'{name} has an auto-generated "nsN:" namespace prefix — draw.io\'s importer will not recognize its tags.')
    return errors


def _check_opc_metadata_integrity(zf: zipfile.ZipFile, names: set[str]) -> list[str]:
    """Duplicate <Override>/<Relationship> entries are invalid per the OPC spec (ECMA-376
    Part 2 §10.1.2.2.1) even though vsdx's own parser tolerates them — this is exactly the
    class of bug that broke draw.io's importer with "Cannot read properties of null" on a
    file vsdx itself round-tripped without complaint. See vsdx_builder._repackage."""
    errors: list[str] = []

    if "[Content_Types].xml" in names:
        root = ET.fromstring(zf.read("[Content_Types].xml"))
        part_names = [el.attrib.get("PartName", "") for el in root.findall(f"{CONTENT_TYPES_NS}Override")]
        for part_name, count in Counter(part_names).items():
            if count > 1:
                errors.append(f'[Content_Types].xml has {count} <Override> entries for PartName="{part_name}" (must be at most 1).')

    for name in sorted(names):
        if not name.endswith(".rels"):
            continue
        root = ET.fromstring(zf.read(name))
        keys = [
            (rel.attrib.get("Type", ""), rel.attrib.get("Target", ""))
            for rel in root.findall(f"{RELATIONSHIPS_NS}Relationship")
        ]
        for key, count in Counter(keys).items():
            if count > 1:
                errors.append(f'{name} has {count} <Relationship> entries for Type/Target={key} (should be deduplicated).')

    return errors


def _check_port_labels_present(shape_elements: list[ET.Element], links: list[Link]) -> list[str]:
    """Every interface name a link carries (e.g. "eth0/1") should appear as some shape's
    text on the page — this is the actual feature the founder asked for after a first-draft
    diagram shipped with unlabeled links, so it gets its own explicit check rather than
    just being implied by the shape count matching.

    Interface names restart per device (every device's first link gets "eth0/0"), so the
    same text is expected to appear many times across a real design — comparing Counters
    (expected occurrences <= actual occurrences, per text) rather than mere set membership
    is what makes this catch one specific missing label instead of only noticing when the
    *last* shape with a given text disappears.
    """
    expected = Counter(interface for link in links for interface in link_interface_names(link) if interface)
    actual = Counter((el.find(f"{NS}Text").text or "").strip() for el in shape_elements if el.find(f"{NS}Text") is not None)

    errors: list[str] = []
    for text, expected_count in expected.items():
        if actual[text] < expected_count:
            errors.append(
                f'Expected {expected_count} shape(s) with port-label text "{text}", found {actual[text]}.',
            )
    return errors


def _check_device_shape_data(shape_elements: list[ET.Element], design: Design) -> list[str]:
    errors: list[str] = []
    shapes_by_device_id = {props["Device ID"]: props for props in (_property_labels(el) for el in shape_elements) if "Device ID" in props}

    for device in design.devices:
        props = shapes_by_device_id.get(device.id)
        if props is None:
            errors.append(f'No shape found with Shape Data "Device ID" = "{device.id}".')
            continue
        if props.get("Role") != device.role:
            errors.append(f'Device "{device.id}": expected Shape Data Role="{device.role}", got "{props.get("Role")}".')
        if props.get("Vendor") != device.vendorHint:
            errors.append(
                f'Device "{device.id}": expected Shape Data Vendor="{device.vendorHint}", got "{props.get("Vendor")}".',
            )

    return errors


def _property_labels(shape_element: ET.Element) -> dict[str, str]:
    """Maps a shape's Shape Data (custom properties) Label -> Value."""
    result: dict[str, str] = {}
    property_section = shape_element.find(f'{NS}Section[@N="Property"]')
    if property_section is None:
        return result
    for row in property_section.findall(f"{NS}Row"):
        label_cell = row.find(f'{NS}Cell[@N="Label"]')
        value_cell = row.find(f'{NS}Cell[@N="Value"]')
        if label_cell is not None and value_cell is not None:
            result[label_cell.attrib.get("V", "")] = value_cell.attrib.get("V", "")
    return result
