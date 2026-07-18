import { describe, expect, it, vi } from "vitest";
import type { ExtractionClient } from "../src/client.js";
import { generateBranchOfficeDesign } from "../src/generate.js";
import { TOOL_NAME } from "../src/prompt.js";

function fakeClient(input: unknown): ExtractionClient {
  return { createMessage: vi.fn().mockResolvedValue({ content: [{ type: "tool_use", name: TOOL_NAME, input }] }) };
}

describe("generateBranchOfficeDesign", () => {
  it("chains extraction and composition into a schema-valid design", async () => {
    const client = fakeClient({
      designPattern: "branch-office",
      siteName: "End-to-End Test Site",
      intentSummary: "Two HSRP routers, two switches, a firewall, three VLANs.",
      siteSupernet: "10.60.0.0/16",
      router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
      accessSwitch: { count: 2, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "fortinet-fortigate" },
      vlans: [{ name: "corp-data" }, { name: "voice", purpose: "voice" }, { name: "guest", purpose: "guest" }],
      assumptions: [],
    });

    const design = await generateBranchOfficeDesign("branch office prose", { client });

    expect(design.meta.name).toBe("End-to-End Test Site");
    expect(design.devices).toHaveLength(5); // 2 routers + 2 switches + 1 firewall
    expect(design.segments).toHaveLength(3);
    expect(design.devices.every((d) => typeof d.mgmtIp === "string")).toBe(true);
  });

  it("rejects (rather than silently coercing) a design pattern the composer can't handle", async () => {
    // The tool schema itself would reject this from a real model, but prove the whole chain fails loudly
    // if something upstream ever hands the composer a pattern it doesn't support.
    const client = fakeClient({
      designPattern: "dc-leaf-spine",
      siteName: "x",
      intentSummary: "x",
      router: { count: 1 },
      accessSwitch: { count: 1 },
      firewall: { present: false },
      vlans: [{ name: "corp" }],
    });

    await expect(generateBranchOfficeDesign("prose", { client })).rejects.toThrow();
  });
});
