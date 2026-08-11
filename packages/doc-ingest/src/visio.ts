import { unzipSync } from "fflate";

/**
 * Reads a .vsdx / .vsdm into a plain-text description of its shapes and
 * connections.
 *
 * A Visio file is structured XML, not a picture, so this is a *deterministic
 * parse*, not a vision problem — the same discipline as packages/config-parse.
 * Feeding the model shape names, shape data and a real connection list is far
 * higher fidelity than asking it to look at a rendering, and it means a .vsdx
 * this app exported round-trips with its roles intact.
 *
 * First-cut limitations, stated plainly so the caller can report them:
 *  - Shape geometry and layout are ignored; only identity and connectivity
 *    are read.
 *  - Grouped/nested shapes are read as a flat list.
 *  - Only the page XML is read; stencils/masters are not resolved, so a shape
 *    with no text of its own shows as its master name or its id.
 */
export interface VisioShape {
  id: string;
  text: string;
  /** Visio "shape data" custom properties — NetDesign's own exports carry role/vendor/hostname here. */
  properties: Record<string, string>;
}

export interface VisioConnection {
  /** Shape ids at each end, in the order Visio recorded them. */
  from: string;
  to: string;
}

export interface VisioPage {
  name: string;
  shapes: VisioShape[];
  connections: VisioConnection[];
}

export function parseVisioFile(bytes: Uint8Array): VisioPage[] {
  const zip = unzipSync(bytes);
  const pageNames = Object.keys(zip)
    .filter((path) => /^visio\/pages\/page\d+\.xml$/i.test(path))
    .sort();

  if (pageNames.length === 0) {
    throw new Error("That Visio file has no readable pages (no visio/pages/page*.xml inside).");
  }

  const decoder = new TextDecoder();
  return pageNames.map((path) => {
    const xml = decoder.decode(zip[path]!);
    return { name: path.replace(/^visio\/pages\//, ""), shapes: readShapes(xml), connections: readConnections(xml) };
  });
}

/** Renders parsed pages as the plain text handed to the model. */
export function describeVisioPages(pages: VisioPage[]): string {
  const lines: string[] = [];

  for (const page of pages) {
    const labelById = new Map(page.shapes.map((shape) => [shape.id, shapeLabel(shape)]));
    lines.push(`Visio page "${page.name}" — ${page.shapes.length} shapes, ${page.connections.length} connections.`);

    lines.push("Shapes:");
    for (const shape of page.shapes) {
      const props = Object.entries(shape.properties)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      lines.push(`  - ${shapeLabel(shape)}${props ? ` (${props})` : ""}`);
    }

    if (page.connections.length > 0) {
      lines.push("Connections:");
      for (const connection of page.connections) {
        const from = labelById.get(connection.from) ?? `shape ${connection.from}`;
        const to = labelById.get(connection.to) ?? `shape ${connection.to}`;
        lines.push(`  - ${from} — ${to}`);
      }
    }
  }

  return lines.join("\n");
}

function shapeLabel(shape: VisioShape): string {
  return shape.text || shape.properties["hostname"] || shape.properties["id"] || `shape ${shape.id}`;
}

function readShapes(xml: string): VisioShape[] {
  const shapes: VisioShape[] = [];
  const shapePattern = /<Shape\b([^>]*)>([\s\S]*?)<\/Shape>/g;

  for (const match of xml.matchAll(shapePattern)) {
    const id = attribute(match[1]!, "ID");
    if (!id) continue;
    shapes.push({ id, text: readShapeText(match[2]!), properties: readShapeProperties(match[2]!) });
  }
  return shapes;
}

function readShapeText(shapeXml: string): string {
  const text = /<Text\b[^>]*>([\s\S]*?)<\/Text>/.exec(shapeXml)?.[1];
  if (!text) return "";
  // Visio interleaves formatting markers (<cp/>, <pp/>, <tp/>) with the runs.
  return decodeXmlEntities(text.replace(/<[^>]*>/g, "")).trim();
}

/**
 * Reads the shape's custom properties (Visio "shape data"). NetDesign's own
 * .vsdx export writes role/vendorHint/hostname/mgmtIp here, so an exported
 * diagram re-uploaded to this app carries its own semantics back in.
 */
function readShapeProperties(shapeXml: string): Record<string, string> {
  const propertySection = /<Section\b[^>]*\bN=['"]Property['"][^>]*>([\s\S]*?)<\/Section>/.exec(shapeXml)?.[1];
  if (!propertySection) return {};

  const properties: Record<string, string> = {};
  for (const row of propertySection.matchAll(/<Row\b([^>]*)>([\s\S]*?)<\/Row>/g)) {
    const name = attribute(row[1]!, "N");
    if (!name) continue;
    const valueCell = /<Cell\b[^>]*\bN=['"]Value['"][^>]*\bV=['"]([^'"]*)['"]/.exec(row[2]!)?.[1];
    if (valueCell) properties[name] = decodeXmlEntities(valueCell);
  }
  return properties;
}

/**
 * Visio records a connector as its own shape plus two <Connect> rows tying
 * that connector's sheet to the shapes at each end, so endpoints are recovered
 * by grouping Connect rows by FromSheet (the connector) and pairing the two
 * ToSheet values.
 */
function readConnections(xml: string): VisioConnection[] {
  const endpointsByConnector = new Map<string, string[]>();

  for (const match of xml.matchAll(/<Connect\b([^>]*)\/>/g)) {
    const fromSheet = attribute(match[1]!, "FromSheet");
    const toSheet = attribute(match[1]!, "ToSheet");
    if (!fromSheet || !toSheet) continue;
    const ends = endpointsByConnector.get(fromSheet) ?? [];
    ends.push(toSheet);
    endpointsByConnector.set(fromSheet, ends);
  }

  const connections: VisioConnection[] = [];
  for (const ends of endpointsByConnector.values()) {
    // A dangling connector (one end glued to nothing) isn't a link — skip it
    // rather than inventing an endpoint.
    if (ends.length >= 2) connections.push({ from: ends[0]!, to: ends[1]! });
  }
  return connections;
}

function attribute(attributes: string, name: string): string | null {
  return new RegExp(`\\b${name}=['"]([^'"]*)['"]`).exec(attributes)?.[1] ?? null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}
