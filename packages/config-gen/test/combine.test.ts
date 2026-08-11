import { describe, expect, it } from "vitest";
import { combineConfigs, commentPrefixFor } from "../src/combine.js";
import { renderAllConfigs } from "../src/render.js";
import { g1Design, g1PanosDesign } from "./fixtures.js";

describe("commentPrefixFor", () => {
  it("uses # for the vendors whose CLI comments with #", () => {
    expect(commentPrefixFor("fortinet-fortigate")).toBe("#");
    expect(commentPrefixFor("paloalto-panos")).toBe("#");
  });

  it("uses ! for cisco and anything else", () => {
    expect(commentPrefixFor("cisco-ios")).toBe("!");
    expect(commentPrefixFor("arista-eos")).toBe("!");
  });
});

describe("combineConfigs — mixed-vendor site", () => {
  const combined = combineConfigs(g1Design, renderAllConfigs(g1Design));

  it("gives cisco devices a ! header", () => {
    expect(combined).toContain("! Device: rtr-01");
    expect(combined).toContain(`${"!".padEnd(60, "=")}\n! Device: rtr-01`);
  });

  it("gives the FortiGate a # header, so the section marker isn't a syntax error on paste", () => {
    expect(combined).toContain("# Device: fw-01");
    expect(combined).not.toContain("! Device: fw-01");
  });

  it("includes every rendered device exactly once", () => {
    const deviceIds = Object.keys(renderAllConfigs(g1Design));
    for (const deviceId of deviceIds) {
      expect((combined.match(new RegExp(`[!#] Device: ${deviceId}$`, "gm")) ?? [])).toHaveLength(1);
    }
  });
});

describe("combineConfigs — Palo Alto edge", () => {
  it("gives the PAN-OS firewall a # header too", () => {
    const combined = combineConfigs(g1PanosDesign, renderAllConfigs(g1PanosDesign));
    expect(combined).toContain("# Device: fw-01");
    expect(combined).not.toContain("! Device: fw-01");
  });
});

describe("combineConfigs — unknown device", () => {
  it("falls back to ! for a config whose device isn't in the design", () => {
    const combined = combineConfigs(g1Design, { "ghost-01": "hostname ghost-01" });
    expect(combined).toContain("! Device: ghost-01");
  });
});
