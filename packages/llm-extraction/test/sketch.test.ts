import { describe, expect, it } from "vitest";
import type { IngestedAsset } from "@netdesign/doc-ingest";
import type { ExtractionClient, ExtractionMessageParams } from "../src/client.js";
import { DesignParamsExtractionError, NeedsClarificationError } from "../src/extract.js";
import { buildContent, composeDesignFromSketch, extractDesignFromDiagram, parseSketchResponse } from "../src/sketch.js";
import { SKETCH_TOOL_NAME, sketchToolInputSchema } from "../src/sketch-prompt.js";
import { CLARIFY_TOOL_NAME } from "../src/prompt.js";

const SKETCH_PARAMS = {
  designPattern: "smb-flat",
  siteName: "Whiteboard Office",
  intentSummary: "Single router, one switch, no firewall — as drawn.",
  router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
  accessSwitch: { count: 1, vendorHint: "cisco-ios" },
  firewall: { present: false, vendorHint: "fortinet-fortigate" },
  vlans: [{ name: "corp", purpose: "user", dhcp: true }],
  assumptions: ["No IP range was written on the sketch; the engine will assign one."],
  confidence: "high",
  observations: ["One router box labelled R1 connects to one switch labelled SW1.", "No firewall is drawn."],
  recommendations: [
    {
      severity: "warning",
      code: "no-edge-firewall",
      message: "No firewall is drawn between the internet link and the user VLAN.",
      devices: ["rtr-01"],
    },
  ],
};

function clientReturning(input: unknown, toolName = SKETCH_TOOL_NAME): ExtractionClient & { sent?: ExtractionMessageParams } {
  const client = {
    sent: undefined as ExtractionMessageParams | undefined,
    async createMessage(params: ExtractionMessageParams) {
      client.sent = params;
      return { content: [{ type: "tool_use", name: toolName, input }] };
    },
  };
  return client;
}

const PNG_ASSET: IngestedAsset = { kind: "image", mediaType: "image/png", base64: "aGk=", label: "whiteboard.png" };
const VISIO_ASSET: IngestedAsset = { kind: "text", text: "Shapes:\n  - rtr-01 (role=router)", label: "site.vsdx" };
const PDF_ASSET: IngestedAsset = { kind: "pdf", base64: "cGRm", label: "topology.pdf" };

describe("extractDesignFromDiagram", () => {
  it("returns the design as drawn and the recommendations separately", async () => {
    const result = await extractDesignFromDiagram([PNG_ASSET], { client: clientReturning(SKETCH_PARAMS) });

    // The sketch had no firewall; the design must not acquire one.
    expect(result.params.firewall.present).toBe(false);
    expect(result.params.router.count).toBe(1);
    // The correction is offered, not applied.
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.code).toBe("no-edge-firewall");
    expect(result.confidence).toBe("high");
    expect(result.observations).toHaveLength(2);
  });

  it("strips the reading metadata so params stay the plain design-params contract", async () => {
    const result = await extractDesignFromDiagram([PNG_ASSET], { client: clientReturning(SKETCH_PARAMS) });

    expect(result.params).not.toHaveProperty("confidence");
    expect(result.params).not.toHaveProperty("observations");
    expect(result.params).not.toHaveProperty("recommendations");
  });

  it("asks instead of guessing when the diagram can't be read", async () => {
    const client = clientReturning({ questions: ["Is the box labelled 'FW' a firewall or a router?"] }, CLARIFY_TOOL_NAME);
    await expect(extractDesignFromDiagram([PNG_ASSET], { client })).rejects.toThrow(NeedsClarificationError);
  });

  it("refuses to call the model with nothing to read", async () => {
    await expect(extractDesignFromDiagram([], { client: clientReturning(SKETCH_PARAMS) })).rejects.toThrow(
      /No diagram content/,
    );
  });

  it("offers both the diagram tool and the clarify tool", async () => {
    const client = clientReturning(SKETCH_PARAMS);
    await extractDesignFromDiagram([PNG_ASSET], { client });
    expect(client.sent!.tools.map((tool) => tool.name)).toEqual([SKETCH_TOOL_NAME, CLARIFY_TOOL_NAME]);
  });
});

describe("buildContent", () => {
  it("sends images as image blocks, PDFs as document blocks and structured text inline", () => {
    const blocks = buildContent([PNG_ASSET, PDF_ASSET, VISIO_ASSET]);

    expect(blocks.find((block) => block.type === "image")).toMatchObject({
      source: { media_type: "image/png", data: "aGk=" },
    });
    expect(blocks.find((block) => block.type === "document")).toMatchObject({
      source: { media_type: "application/pdf", data: "cGRm" },
    });
    const texts = blocks.filter((block) => block.type === "text").map((block) => (block as { text: string }).text);
    expect(texts.join("\n")).toContain("rtr-01 (role=router)");
  });

  it("labels every asset so observations can refer to the right file", () => {
    const texts = buildContent([PNG_ASSET, VISIO_ASSET])
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text);

    expect(texts).toContain("--- whiteboard.png ---");
    expect(texts).toContain("--- site.vsdx ---");
  });

  it("passes the engineer's own notes through first", () => {
    const blocks = buildContent([PNG_ASSET], "The dotted line is a planned link, not built yet.");
    expect((blocks[0] as { text: string }).text).toContain("dotted line is a planned link");
  });
});

describe("parseSketchResponse validation", () => {
  it("rejects a reading that isn't schema-valid rather than composing from it", () => {
    const response = { content: [{ type: "tool_use", name: SKETCH_TOOL_NAME, input: { siteName: "Nope" } }] };
    expect(() => parseSketchResponse(response)).toThrow(DesignParamsExtractionError);
  });

  it("defaults recommendations and observations to empty when the model omits them", () => {
    const { recommendations, observations, ...rest } = SKETCH_PARAMS;
    const result = parseSketchResponse({ content: [{ type: "tool_use", name: SKETCH_TOOL_NAME, input: rest }] });
    expect(result.recommendations).toEqual([]);
    expect(result.observations).toEqual([]);
  });

  it("errors when no tool was called at all", () => {
    expect(() => parseSketchResponse({ content: [{ type: "text", text: "here's a design" }] })).toThrow(
      /did not call the "emit_design_from_diagram" tool/,
    );
  });
});

describe("composeDesignFromSketch", () => {
  const extraction = parseSketchResponse({
    content: [{ type: "tool_use", name: SKETCH_TOOL_NAME, input: SKETCH_PARAMS }],
  });

  it("composes the design that was drawn, without applying the recommendation", () => {
    const { design, recommendations } = composeDesignFromSketch(extraction);

    expect(design.devices.filter((device) => device.role === "router")).toHaveLength(1);
    // The recommendation was "add a firewall" — the design must still have none.
    expect(design.devices.find((device) => device.role === "firewall")).toBeUndefined();
    expect(recommendations).toHaveLength(1);
  });

  it("records what was read as assumptions, so the reading is reviewable", () => {
    const { design } = composeDesignFromSketch(extraction, ["site.vsdx: read the Visio shapes directly."]);

    const assumptions = design.meta.assumptions.join("\n");
    expect(assumptions).toContain("site.vsdx: read the Visio shapes directly.");
    expect(assumptions).toContain("Read from the diagram: One router box labelled R1");
    expect(assumptions).toContain("No IP range was written on the sketch");
  });

  it("warns in the design itself when confidence was not high", () => {
    const lowConfidence = parseSketchResponse({
      content: [{ type: "tool_use", name: SKETCH_TOOL_NAME, input: { ...SKETCH_PARAMS, confidence: "medium" } }],
    });
    const { design } = composeDesignFromSketch(lowConfidence);
    expect(design.meta.assumptions.join("\n")).toContain("read with medium confidence");
  });
});

describe("sketchToolInputSchema", () => {
  it("requires the model to state its confidence", () => {
    expect(sketchToolInputSchema["required"]).toContain("confidence");
  });

  it("keeps the design-params contract intact alongside the reading fields", () => {
    const properties = sketchToolInputSchema["properties"] as Record<string, unknown>;
    for (const field of ["designPattern", "router", "accessSwitch", "firewall", "vlans", "recommendations"]) {
      expect(properties).toHaveProperty(field);
    }
  });
});
