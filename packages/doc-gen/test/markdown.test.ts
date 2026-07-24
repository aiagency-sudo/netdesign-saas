import { describe, expect, it } from "vitest";
import { generateHldMarkdown } from "../src/markdown.js";
import { g1Design, g4Design } from "./fixtures.js";

describe("generateHldMarkdown", () => {
  it("matches the G1 branch-office snapshot", () => {
    expect(generateHldMarkdown(g1Design)).toMatchSnapshot();
  });

  it("matches the G4 smb-flat snapshot", () => {
    expect(generateHldMarkdown(g4Design)).toMatchSnapshot();
  });

  it("includes every device and segment by name", () => {
    const markdown = generateHldMarkdown(g1Design);
    for (const device of g1Design.devices) {
      expect(markdown).toContain(device.id);
    }
    for (const segment of g1Design.segments) {
      expect(markdown).toContain(segment.name);
      expect(markdown).toContain(segment.cidr);
    }
  });

  it("renders assumptions, or a fallback line when there are none", () => {
    const markdown = generateHldMarkdown(g1Design);
    expect(markdown).toContain("## Assumptions");

    const noAssumptions = { ...g1Design, meta: { ...g1Design.meta, assumptions: [] } };
    expect(generateHldMarkdown(noAssumptions)).toContain("No assumptions were recorded for this design.");
  });

  it("omits the Warnings section entirely when there are none", () => {
    const markdown = generateHldMarkdown(g1Design);
    expect(markdown).not.toContain("## Warnings");
  });

  it("renders trunk interfaces distinctly from P2P interfaces", () => {
    const markdown = generateHldMarkdown(g1Design);
    expect(markdown).toContain("Trunk (VLANs:");
    expect(markdown).toMatch(/\/31/);
  });

  it("notes there are no zones or policies when the design has neither (G1 devices carry no zone)", () => {
    const markdown = generateHldMarkdown(g1Design);
    expect(markdown).toContain("## Security Zones");
    expect(markdown).toContain("No zones or zone policies are defined for this design.");
  });

  it("lists bare device zones when zones exist but no explicit policies do", () => {
    const withZones = {
      ...g1Design,
      devices: g1Design.devices.map((device, index) => ({ ...device, zone: index === 0 ? "inside" : "dmz" })),
    };
    const markdown = generateHldMarkdown(withZones);
    expect(markdown).toContain("Zones present on this design:");
    expect(markdown).toContain("No explicit zone policies or NAT rules have been defined yet.");
  });
});
