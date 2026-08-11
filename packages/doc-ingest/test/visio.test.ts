import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeVisioPages, parseVisioFile } from "../src/visio.js";
import { ingestUploads } from "../src/ingest.js";

/**
 * A REAL .vsdx, produced by this repo's own services/vsdx exporter from the G1
 * golden design — not a hand-written fixture. Because we own both halves, the
 * strongest available check is the round trip: export a known design, read it
 * back, and assert the devices and links survive. Regenerate with:
 *
 *   cd services/vsdx && .venv/bin/python -c "import json,pathlib,sys; sys.path.insert(0,'.'); \
 *     from app.models import Design; from app.vsdx_builder import build_vsdx_bytes; \
 *     pathlib.Path('../../packages/doc-ingest/test/fixtures/g1-branch-office.vsdx').write_bytes( \
 *     build_vsdx_bytes(Design.model_validate(json.loads(pathlib.Path('tests/fixtures/g1_branch_office.json').read_text()))))"
 */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "g1-branch-office.vsdx");
const bytes = new Uint8Array(readFileSync(FIXTURE));

const G1_DEVICES = ["rtr-01", "rtr-02", "sw-01", "sw-02", "fw-01"];

describe("parseVisioFile — round trip against our own .vsdx export", () => {
  const pages = parseVisioFile(bytes);

  it("reads a single page", () => {
    expect(pages).toHaveLength(1);
  });

  it("recovers every device the design contained", () => {
    const labels = pages[0]!.shapes.map((shape) => shape.text);
    for (const device of G1_DEVICES) {
      expect(labels).toContain(device);
    }
  });

  it("recovers the shape data the exporter embedded, so roles survive the round trip", () => {
    const shapeByText = new Map(pages[0]!.shapes.map((shape) => [shape.text, shape]));

    expect(shapeByText.get("rtr-01")!.properties["role"]).toBe("router");
    expect(shapeByText.get("fw-01")!.properties["role"]).toBe("firewall");
    expect(shapeByText.get("fw-01")!.properties["vendorHint"]).toBe("fortinet-fortigate");
    expect(shapeByText.get("sw-01")!.properties["role"]).toBe("access-switch");
  });

  it("recovers the links as connections between real devices", () => {
    const { shapes, connections } = pages[0]!;
    const labelById = new Map(shapes.map((shape) => [shape.id, shape.text]));

    // G1's 5 links: the firewall to each router, each access switch to its
    // router, and the switch interlink. (There is deliberately no direct
    // router-to-router link — the HSRP pair is adjacent through the access
    // layer, which is exactly what the composer builds.)
    const pairs = connections.map(({ from, to }) => [labelById.get(from), labelById.get(to)].sort().join("—")).sort();
    expect(pairs).toEqual([
      "fw-01—rtr-01",
      "fw-01—rtr-02",
      "rtr-01—sw-01",
      "rtr-02—sw-02",
      "sw-01—sw-02",
    ]);
  });

  it("never invents an endpoint: every connection names two known shapes", () => {
    const ids = new Set(pages[0]!.shapes.map((shape) => shape.id));
    for (const connection of pages[0]!.connections) {
      expect(ids.has(connection.from) || ids.has(connection.to)).toBe(true);
    }
  });
});

describe("describeVisioPages", () => {
  it("renders devices, their shape data and their links as readable text", () => {
    const description = describeVisioPages(parseVisioFile(bytes));

    expect(description).toContain("Shapes:");
    expect(description).toContain("Connections:");
    expect(description).toMatch(/rtr-01 \(.*role=router/);
    expect(description).toContain("rtr-01 — fw-01");
  });
});

describe("ingestUploads — Visio", () => {
  it("reads a .vsdx as structured text, not as a picture", () => {
    const { assets, notes } = ingestUploads([{ name: "g1.vsdx", bytes }]);

    expect(assets).toHaveLength(1);
    expect(assets[0]!.kind).toBe("text");
    expect(assets[0]!.kind === "text" && assets[0]!.text).toContain("rtr-01");
    expect(notes.join(" ")).toContain("read the Visio shapes and connections directly");
  });

  it("reports a corrupt Visio file by name instead of failing obscurely", () => {
    const notAZip = new Uint8Array([1, 2, 3, 4]);
    expect(() => ingestUploads([{ name: "broken.vsdx", bytes: notAZip }])).toThrow(/broken\.vsdx couldn't be read/);
  });
});
