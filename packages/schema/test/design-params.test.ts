import { describe, expect, it } from "vitest";
import { designParamsSchema } from "../src/index.js";

describe("designParamsSchema", () => {
  const minimal = {
    designPattern: "smb-flat",
    siteName: "Test Site",
    intentSummary: "One router, one switch, one firewall.",
    router: { count: 1 },
    accessSwitch: { count: 1 },
    firewall: { present: true },
    vlans: [{ name: "corp" }],
  };

  it("accepts a minimal payload and fills in defaults", () => {
    const result = designParamsSchema.parse(minimal);
    expect(result.router.redundancy).toBe("none");
    expect(result.router.vendorHint).toBe("cisco-ios");
    expect(result.firewall.vendorHint).toBe("fortinet-fortigate");
    expect(result.vlans[0]).toEqual({ name: "corp", purpose: "user", dhcp: true });
    expect(result.assumptions).toEqual([]);
  });

  it("rejects an unsupported designPattern (only branch-office/smb-flat are composable today)", () => {
    const result = designParamsSchema.safeParse({ ...minimal, designPattern: "dc-leaf-spine" });
    expect(result.success).toBe(false);
  });

  it("rejects a router count above the current cap of 2", () => {
    const result = designParamsSchema.safeParse({ ...minimal, router: { count: 3 } });
    expect(result.success).toBe(false);
  });

  it("rejects an empty vlans array", () => {
    const result = designParamsSchema.safeParse({ ...minimal, vlans: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed siteSupernet", () => {
    const result = designParamsSchema.safeParse({ ...minimal, siteSupernet: "not-a-cidr" });
    expect(result.success).toBe(false);
  });
});
