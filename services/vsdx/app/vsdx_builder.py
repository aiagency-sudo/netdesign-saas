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
RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

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
                _add_port_labels(page, link, shape_by_device_id)

            vis.save_vsdx(str(output_path))

        return _repackage(output_path.read_bytes())


def _repackage(data: bytes) -> bytes:
    """Post-save pass over every XML/rels part in the saved zip, working around two vsdx 0.6.1
    issues neither of which vsdx's own (lenient) parser notices, but which broke draw.io's
    stricter importer with "Cannot read properties of null (reading 'getElementsByTagName')":

    1. Duplicate <Override>/<Relationship> entries. Connect.create() re-runs its "bootstrap the
       connector master" branch on *every* call instead of only the first (its guard checks a
       real filesystem path that's never populated in this in-memory-zip flow), appending
       another [Content_Types].xml <Override> and document.xml.rels <Relationship> for the same
       masters files each time — invalid per the OPC spec (ECMA-376 Part 2 §10.1.2.2.1: at most
       one Override per part).
    2. Auto-generated "ns0:" namespace prefixes. vsdx never calls ET.register_namespace(), so
       every part it re-serializes gets a prefix (<ns0:PageContents> instead of
       <PageContents xmlns="...">). draw.io's importer matches tag/attribute names as bare
       string literals (`child.tagName === "PageContents"`, `getElementsByTagName("Relationship")`),
       which silently fail against a prefixed name.

    Fixing #2 can't be done with one upfront `ET.register_namespace("", uri)` call: it's a single
    *global* slot, and vsdx serializes multiple differently-namespaced parts (Visio content,
    OPC relationships) within one save_vsdx() call, so each part needs the registry pointed at
    *its own* namespace right before *that part's* serialization — hence a part-by-part pass
    here rather than a one-time setting. See services/vsdx/README.md for the full writeup.
    """
    src = zipfile.ZipFile(io.BytesIO(data))

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            content = src.read(item.filename)
            if item.filename.endswith(".xml") or item.filename.endswith(".rels"):
                content = _normalize_xml_part(item.filename, content)
            dst.writestr(item, content)
    return out.getvalue()


def _normalize_xml_part(filename: str, xml_bytes: bytes) -> bytes:
    root = ET.fromstring(xml_bytes)

    ns_uri = _namespace_of(root.tag)
    if ns_uri is not None:
        ET.register_namespace("", ns_uri)

    if filename == "[Content_Types].xml":
        _dedupe_by_attr(root, "Override", "PartName")
    elif filename.endswith(".rels"):
        _dedupe_relationships(root)

    return ET.tostring(root, xml_declaration=True, encoding="UTF-8")


def _namespace_of(tag: str) -> str | None:
    if tag.startswith("{"):
        return tag[1:].split("}", 1)[0]
    return None


def _dedupe_by_attr(root: ET.Element, tag: str, key_attr: str) -> None:
    ns_uri = _namespace_of(root.tag)
    seen: set[str] = set()
    for el in list(root.findall(f"{{{ns_uri}}}{tag}")):
        key = el.attrib.get(key_attr, "")
        if key in seen:
            root.remove(el)
        else:
            seen.add(key)


def _dedupe_relationships(root: ET.Element) -> None:
    seen: set[tuple[str, str]] = set()
    for rel in list(root.findall(f"{{{RELATIONSHIPS_NS}}}Relationship")):
        key = (rel.attrib.get("Type", ""), rel.attrib.get("Target", ""))
        if key in seen:
            root.remove(rel)
        else:
            seen.add(key)


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


def link_interface_names(link: Link) -> tuple[str | None, str | None]:
    """The optional ":interface" suffix on a link's a/b (e.g. "rtr-01:eth0/1" -> "eth0/1"), if present."""

    def interface_of(endpoint: str) -> str | None:
        parts = endpoint.split(":", 1)
        return parts[1] if len(parts) == 2 else None

    return interface_of(link.a), interface_of(link.b)


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


PORT_LABEL_WIDTH_IN = 0.7
PORT_LABEL_HEIGHT_IN = 0.2
PORT_LABEL_OFFSET_IN = 0.9  # distance from a device's center, along the line to its link partner


def _add_port_labels(page: "vsdx.Page", link: Link, shape_by_device_id: dict[str, "vsdx.Shape"]) -> None:
    """Small borderless text shapes near each end of a connector showing that side's
    interface name (g1/1, eth0/1, ...) — what the founder specifically asked for after
    seeing a first-draft diagram with unlabeled links."""
    interface_a, interface_b = link_interface_names(link)
    if not interface_a and not interface_b:
        return

    from_id, to_id = link_device_ids(link)
    from_shape = shape_by_device_id[from_id]
    to_shape = shape_by_device_id[to_id]

    if interface_a:
        x, y = _port_label_position(from_shape.center_x_y, to_shape.center_x_y, _interface_index(interface_a))
        _add_port_label(page, x, y, interface_a)
    if interface_b:
        x, y = _port_label_position(to_shape.center_x_y, from_shape.center_x_y, _interface_index(interface_b))
        _add_port_label(page, x, y, interface_b)


def _interface_index(interface_name: str) -> int:
    """"eth0/3" -> 3. Falls back to 0 (no jitter) for a name that doesn't end in a number —
    defensive only; every name this module itself assigns follows the eth0/N convention."""
    try:
        return int(interface_name.rsplit("/", 1)[-1])
    except ValueError:
        return 0


PORT_LABEL_JITTER_STEP_IN = 0.18


def _port_label_position(near_xy: tuple[float, float], far_xy: tuple[float, float], index: int) -> tuple[float, float]:
    """A point PORT_LABEL_OFFSET_IN from `near_xy`, along the line toward `far_xy` — just
    outside the near shape's edge — but never more than halfway there, so labels on very
    short links (e.g. two adjacent grid cells) don't overshoot past the midpoint.

    A device's links don't all point in different directions — e.g. every device in a grid
    layout's rightmost column points left toward everything else — so two labels near the
    same device can land on the exact same point (confirmed: G1's sw-02 has both its
    rtr-02-facing and sw-01-facing labels compute to an identical coordinate, silently
    hiding one underneath the other). `index` is that interface's own eth0/N number at this
    device, which is already unique per device by construction, so nudging perpendicular to
    the line by an amount that strictly grows with `index` (0, 1, -1, 2, -2, ...) guarantees
    two labels at the same device never coincide, regardless of how their directions compare.
    """
    nx, ny = near_xy
    fx, fy = far_xy
    dx, dy = fx - nx, fy - ny
    distance = math.hypot(dx, dy)
    if distance < 1e-6:
        return nx, ny
    t = min(PORT_LABEL_OFFSET_IN / distance, 0.45)
    base_x, base_y = nx + dx * t, ny + dy * t

    if index == 0:
        return base_x, base_y
    perp_x, perp_y = -dy / distance, dx / distance
    magnitude = index * PORT_LABEL_JITTER_STEP_IN
    sign = 1 if index % 2 == 0 else -1
    return base_x + perp_x * magnitude * sign, base_y + perp_y * magnitude * sign


def _add_port_label(page: "vsdx.Page", pin_x: float, pin_y: float, text: str) -> None:
    shapes_el = page.xml.getroot().find(f"{NS}Shapes")
    if shapes_el is None:
        shapes_el = ET.SubElement(page.xml.getroot(), f"{NS}Shapes")

    shape_id = page.set_max_ids() + 1  # re-scans the page each time, so this is always collision-free
    shape_xml = _port_label_shape_xml(shape_id, pin_x, pin_y, text)
    shapes_el.append(shape_xml)


def _port_label_shape_xml(shape_id: int, pin_x: float, pin_y: float, text: str) -> ET.Element:
    xml_str = f"""<Shape xmlns="{NS_URI}" ID="{shape_id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">
        <Cell N="PinX" V="{pin_x}"/><Cell N="PinY" V="{pin_y}"/>
        <Cell N="Width" V="{PORT_LABEL_WIDTH_IN}"/><Cell N="Height" V="{PORT_LABEL_HEIGHT_IN}"/>
        <Cell N="LocPinX" V="{PORT_LABEL_WIDTH_IN / 2}" F="Width*0.5"/><Cell N="LocPinY" V="{PORT_LABEL_HEIGHT_IN / 2}" F="Height*0.5"/>
        <Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/><Cell N="ResizeMode" V="0"/>
        <Cell N="FillPattern" V="0"/><Cell N="LinePattern" V="0"/>
        <Section N="Geometry" IX="0">
            <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
            <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
            <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
            <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
            <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
        </Section>
        <Text>{_xml_escape(text)}</Text>
    </Shape>"""
    return ET.fromstring(xml_str)


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
