import { describe, expect, it, vi } from "vitest";
import type { ExtractionClient } from "../src/client.js";
import { generateDesign } from "../src/generate.js";
import { TOOL_NAME } from "../src/prompt.js";

function fakeClient(input: unknown): ExtractionClient {
  return { createMessage: vi.fn().mockResolvedValue({ content: [{ type: "tool_use", name: TOOL_NAME, input }] }) };
}

describe("generateDesign", () => {
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

    const design = await generateDesign("branch office prose", { client });

    expect(design.meta.name).toBe("End-to-End Test Site");
    expect(design.devices).toHaveLength(5); // 2 routers + 2 switches + 1 firewall
    expect(design.segments).toHaveLength(3);
    expect(design.devices.every((d) => typeof d.mgmtIp === "string")).toBe(true);
  });

  it("dispatches a campus-three-tier extraction to the campus composer", async () => {
    const client = fakeClient({
      designPattern: "campus-three-tier",
      siteName: "Campus End-to-End",
      intentSummary: "Three-tier campus: firewall, dual routers, L3 core pair, HSRP distribution, six access switches.",
      siteSupernet: "10.20.0.0/16",
      router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
      accessSwitch: { count: 6, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "fortinet-fortigate" },
      coreSwitch: { count: 2, vendorHint: "cisco-ios" },
      distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
      vlans: [{ name: "corp-data" }, { name: "voice", purpose: "voice" }],
      assumptions: [],
    });

    const design = await generateDesign("campus prose", { client });

    expect(design.meta.name).toBe("Campus End-to-End");
    expect(design.devices).toHaveLength(13); // 1 fw + 2 routers + 2 core + 2 dist + 6 access
    expect(design.routing?.igp).toBe("ospf");
    // The VLAN gateways (SVIs) live on the distribution pair, and only there.
    const dists = design.devices.filter((d) => d.role === "distribution-switch");
    expect(dists).toHaveLength(2);
    expect(dists.every((d) => d.redundancyGroup === "hsrp-dist")).toBe(true);
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

    await expect(generateDesign("prose", { client })).rejects.toThrow();
  });
});
