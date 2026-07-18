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
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field

import vsdx

from app.models import Design
from app.vsdx_builder import renderable_links

NS = vsdx.namespace

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
    expected_shape_count = len(design.devices) + len(links)
    expected_connect_count = 2 * len(links)

    shapes_el = root.find(f"{NS}Shapes")
    shape_elements = shapes_el.findall(f"{NS}Shape") if shapes_el is not None else []
    if len(shape_elements) != expected_shape_count:
        errors.append(
            f"Expected {expected_shape_count} top-level shapes "
            f"({len(design.devices)} devices + {len(links)} connectors), found {len(shape_elements)}.",
        )

    connects_el = root.find(f"{NS}Connects")
    connect_elements = connects_el.findall(f"{NS}Connect") if connects_el is not None else []
    if len(connect_elements) != expected_connect_count:
        errors.append(
            f"Expected {expected_connect_count} <Connect> elements (2 per link), found {len(connect_elements)}.",
        )

    errors.extend(_check_device_shape_data(shape_elements, design))

    return StructuralValidationResult(ok=len(errors) == 0, errors=errors)


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
