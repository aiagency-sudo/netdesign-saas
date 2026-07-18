"""Design JSON -> .vsdx diagram.

Renders one rectangle shape per device (fill color by role, id/role/vendor/
mgmt/loopback embedded as Visio Shape Data / custom properties) and one
connector per link, laid out on a grid.

Built on the `vsdx` library (the only place this service touches Visio's
OOXML directly). `vsdx.VisioFile(path)` can only *open* an existing file —
there's no "create blank" constructor — so every export starts from the
checked-in `app/templates/blank.vsdx` (see
`app/templates/generate_blank_template.py` for its provenance) copied to a
throwaway temp path. Shapes are built as raw XML Elements (position/size/
fill/text/custom-properties) rather than copied from a master, since the
template intentionally carries no master shapes; `vsdx.Connect.create()` is
used for connectors, which lazily pulls the connector master out of vsdx's
own bundled `media.vsdx` on first use — that's the library's documented
behavior, not something this module manages.
"""

from __future__ import annotations

import contextlib
import io
import math
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path

import vsdx

from app.colors import fill_color_for_role
from app.models import Design, Device, Link

NS = vsdx.namespace  # '{http://schemas.microsoft.com/office/visio/2012/main}'
NS_URI = NS[1:-1]

TEMPLATE_PATH = Path(__file__).parent / "templates" / "blank.vsdx"

SHAPE_WIDTH_IN = 1.5
SHAPE_HEIGHT_IN = 0.75
MARGIN_IN = 1.0
SPACING_X_IN = 2.5
SPACING_Y_IN = 1.75
MAX_COLUMNS = 4

# Device fields embedded as Visio Shape Data on every device's shape, in order.
SHAPE_DATA_FIELDS: list[tuple[str, str]] = [
    ("id", "Device ID"),
    ("role", "Role"),
    ("vendorHint", "Vendor"),
    ("hostname", "Hostname"),
    ("mgmtIp", "Mgmt IP"),
    ("loopback", "Loopback"),
    ("zone", "Zone"),
]


class VsdxBuildError(Exception):
    """Raised when a design JSON can't be rendered — always a human-readable reason."""


def build_vsdx_bytes(design: Design) -> bytes:
    if not TEMPLATE_PATH.exists():
        raise VsdxBuildError(
            f"Blank vsdx template is missing at {TEMPLATE_PATH}. Regenerate it with "
            "app/templates/generate_blank_template.py.",
        )

    id_counts = Counter(device.id for device in design.devices)
    duplicate_ids = sorted(id_ for id_, count in id_counts.items() if count > 1)
    if duplicate_ids:
        raise VsdxBuildError(f"Design has duplicate device ids: {duplicate_ids}")

    with tempfile.TemporaryDirectory(prefix="netdesign-vsdx-") as tmpdir:
        working_path = Path(tmpdir) / "working.vsdx"
        output_path = Path(tmpdir) / "output.vsdx"
        shutil.copyfile(TEMPLATE_PATH, working_path)

        with vsdx.VisioFile(str(working_path)) as vis:
            page = vis.get_page(0)
            _size_page_for_device_count(page, len(design.devices))

            shape_by_device_id: dict[str, vsdx.Shape] = {}
            for index, device in enumerate(design.devices):
                shape = _add_device_shape(page, device, index, len(design.devices))
                shape_by_device_id[device.id] = shape
            page.set_max_ids()

            for link in renderable_links(design):
                _add_link_connector(page, link, shape_by_device_id)

            vis.save_vsdx(str(output_path))

        return _dedupe_opc_metadata(output_path.read_bytes())


CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _dedupe_opc_metadata(data: bytes) -> bytes:
    """Works around a vsdx 0.6.1 bug: Connect.create() re-runs its "bootstrap the connector
    master" branch on *every* call instead of only the first, because its guard
    (`os.path.exists(page.vis._masters_folder)`) checks a real filesystem path that's never
    actually populated in this in-memory-zip flow. Each call appends another
    <Override>/<Relationship> for the same masters files without checking whether one already
    exists — for a design with N link connectors, that's N (or N+1) duplicate entries.

    Duplicate <Override PartName="..."> entries in [Content_Types].xml are invalid per the OPC
    spec (ECMA-376 Part 2 §10.1.2.2.1: at most one Override per part), and this is what tripped
    up draw.io's importer ("Cannot read properties of null (reading 'getElementsByTagName')")
    even though vsdx's own (more lenient) parser round-trips it fine. Collapse both files to one
    entry per part/relationship, keeping the first occurrence, as a post-save pass — simpler and
    more robust than trying to patch vsdx's internal bootstrap logic.
    """
    src = zipfile.ZipFile(io.BytesIO(data))
    fixed_content_types = _dedupe_by_attr(
        src.read("[Content_Types].xml"), CONTENT_TYPES_NS, "Override", "PartName",
    )
    fixed_document_rels = _dedupe_relationships(src.read("visio/_rels/document.xml.rels"))

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            if item.filename == "[Content_Types].xml":
                dst.writestr(item, fixed_content_types)
            elif item.filename == "visio/_rels/document.xml.rels":
                dst.writestr(item, fixed_document_rels)
            else:
                dst.writestr(item, src.read(item.filename))
    return out.getvalue()


def _dedupe_by_attr(xml_bytes: bytes, ns_uri: str, tag: str, key_attr: str) -> bytes:
    ET.register_namespace("", ns_uri)
    root = ET.fromstring(xml_bytes)
    seen: set[str] = set()
    for el in list(root.findall(f"{{{ns_uri}}}{tag}")):
        key = el.attrib.get(key_attr, "")
        if key in seen:
            root.remove(el)
        else:
            seen.add(key)
    return ET.tostring(root, xml_declaration=True, encoding="UTF-8")


def _dedupe_relationships(xml_bytes: bytes) -> bytes:
    ET.register_namespace("", RELATIONSHIPS_NS)
    root = ET.fromstring(xml_bytes)
    seen: set[tuple[str, str]] = set()
    for rel in list(root.findall(f"{{{RELATIONSHIPS_NS}}}Relationship")):
        key = (rel.attrib.get("Type", ""), rel.attrib.get("Target", ""))
        if key in seen:
            root.remove(rel)
        else:
            seen.add(key)
    return ET.tostring(root, xml_declaration=True, encoding="UTF-8")


def _size_page_for_device_count(page: "vsdx.Page", device_count: int) -> None:
    if device_count == 0:
        return
    columns = min(MAX_COLUMNS, device_count)
    rows = math.ceil(device_count / columns)
    required_width = 2 * MARGIN_IN + columns * SPACING_X_IN
    required_height = 2 * MARGIN_IN + rows * SPACING_Y_IN

    for cell_name, required in (("PageWidth", required_width), ("PageHeight", required_height)):
        cell = page._pagesheet_xml.find(f'{NS}Cell[@N="{cell_name}"]')  # noqa: SLF001 - vsdx exposes no public setter
        if cell is not None and float(cell.attrib.get("V", 0)) < required:
            cell.attrib["V"] = str(required)


def _grid_position(index: int, device_count: int, page_height: float) -> tuple[float, float]:
    columns = min(MAX_COLUMNS, device_count)
    row, col = divmod(index, columns)
    x = MARGIN_IN + col * SPACING_X_IN + SHAPE_WIDTH_IN / 2
    y = page_height - MARGIN_IN - row * SPACING_Y_IN - SHAPE_HEIGHT_IN / 2
    return x, y


def _add_device_shape(page: "vsdx.Page", device: Device, index: int, device_count: int) -> "vsdx.Shape":
    shapes_el = page.xml.getroot().find(f"{NS}Shapes")
    if shapes_el is None:
        shapes_el = ET.SubElement(page.xml.getroot(), f"{NS}Shapes")

    shape_id = index + 1
    pin_x, pin_y = _grid_position(index, device_count, page.height)
    fill_hex = fill_color_for_role(device.role)
    text = device.hostname or device.id

    props: dict[str, tuple[str, str]] = {}
    for field_name, label in SHAPE_DATA_FIELDS:
        value = getattr(device, field_name, None)
        if value:
            props[field_name] = (label, str(value))

    shape_xml = _rect_shape_xml(shape_id, pin_x, pin_y, text, fill_hex, props)
    shapes_el.append(shape_xml)
    return vsdx.Shape(xml=shape_xml, parent=page, page=page)


def link_device_ids(link: Link) -> tuple[str, str]:
    """A link's a/b may be "deviceId" or "deviceId:interface" per design-schema.json; strip the interface part."""
    return link.a.split(":", 1)[0], link.b.split(":", 1)[0]


def renderable_links(design: Design) -> list[Link]:
    """Links where both ends are devices in this design — an end pointing outside the device
    list (e.g. an external ISP hop) has no shape to connect, so it's not ours to draw."""
    device_ids = {device.id for device in design.devices}
    result = []
    for link in design.links:
        from_id, to_id = link_device_ids(link)
        if from_id in device_ids and to_id in device_ids:
            result.append(link)
    return result


def _add_link_connector(page: "vsdx.Page", link: Link, shape_by_device_id: dict[str, "vsdx.Shape"]) -> None:
    from_id, to_id = link_device_ids(link)
    from_shape = shape_by_device_id[from_id]
    to_shape = shape_by_device_id[to_id]

    # vsdx.Connect.create() prints debug lines (geometry/master-page internals) unconditionally;
    # swallow them rather than spamming this service's logs on every export.
    with contextlib.redirect_stdout(io.StringIO()):
        connector = vsdx.Connect.create(page=page, from_shape=from_shape, to_shape=to_shape)
    if link.label:
        connector.text = link.label
    _fix_connector_trigger_formulas(connector)


def _fix_connector_trigger_formulas(connector: "vsdx.Shape") -> None:
    """Works around a vsdx 0.6.1 bug where Connect.create()'s string replace drops the
    dot in "Sheet.N!" (producing "SheetN!"), which breaks Visio's live re-glue tracking
    even though the <Connect> elements that vsdx itself round-trips on are unaffected."""
    for cell_name in ("BegTrigger", "EndTrigger"):
        cell = connector.cells.get(cell_name)
        if cell is not None and cell.formula:
            cell.formula = re.sub(r"Sheet(\d+)!", r"Sheet.\1!", cell.formula)


def _rect_shape_xml(
    shape_id: int,
    pin_x: float,
    pin_y: float,
    text: str,
    fill_hex: str,
    props: dict[str, tuple[str, str]],
) -> ET.Element:
    prop_rows = "".join(
        f"""
        <Row N="{_xml_escape(key)}">
          <Cell N="Value" V="{_xml_escape(value)}" U="STR"/>
          <Cell N="Label" V="{_xml_escape(label)}"/>
          <Cell N="Type" V="0"/>
        </Row>"""
        for key, (label, value) in props.items()
    )
    xml_str = f"""<Shape xmlns="{NS_URI}" ID="{shape_id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
        <Cell N="PinX" V="{pin_x}"/><Cell N="PinY" V="{pin_y}"/>
        <Cell N="Width" V="{SHAPE_WIDTH_IN}"/><Cell N="Height" V="{SHAPE_HEIGHT_IN}"/>
        <Cell N="LocPinX" V="{SHAPE_WIDTH_IN / 2}" F="Width*0.5"/><Cell N="LocPinY" V="{SHAPE_HEIGHT_IN / 2}" F="Height*0.5"/>
        <Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/><Cell N="ResizeMode" V="0"/>
        <Cell N="FillForegnd" V="{fill_hex}"/><Cell N="FillPattern" V="1"/>
        <Cell N="LineColor" V="#000000"/><Cell N="LinePattern" V="1"/><Cell N="LineWeight" V="0.01"/>
        <Section N="Geometry" IX="0">
            <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
            <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
            <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
            <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
            <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
        </Section>
        <Section N="Property" IX="0">{prop_rows}
        </Section>
        <Text>{_xml_escape(text)}</Text>
    </Shape>"""
    return ET.fromstring(xml_str)


def _xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
