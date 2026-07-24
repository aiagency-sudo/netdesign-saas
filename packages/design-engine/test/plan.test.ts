import { describe, expect, it } from "vitest";
import { L3_CAPABLE_ROLES, planIpAllocation } from "../src/ip-allocation/plan.js";

describe("planIpAllocation", () => {
  it("defaults link.kind to ethernet when omitted", () => {
    const plan = planIpAllocation({
      siteSupernet: "10.0.0.0/16",
      devices: [
        { id: "rtr-01", role: "router" },
        { id: "rtr-02", role: "router" },
      ],
      links: [{ id: "rtr01-rtr02", a: "rtr-01", b: "rtr-02" }],
      segments: [],
    });
    expect(plan.p2pLinks["rtr01-rtr02"]).toBeDefined();
  });

  it("skips P2P allocation for wireless/vpn-tunnel/virtual link kinds", () => {
    const plan = planIpAllocation({
      siteSupernet: "10.0.0.0/16",
      devices: [
        { id: "rtr-01", role: "router" },
        { id: "rtr-02", role: "router" },
      ],
      links: [
        { id: "l1", a: "rtr-01", b: "rtr-02", kind: "vpn-tunnel" },
        { id: "l2", a: "rtr-01", b: "rtr-02", kind: "wireless" },
        { id: "l3", a: "rtr-01", b: "rtr-02", kind: "virtual" },
      ],
      segments: [],
    });
    expect(plan.p2pLinks).toEqual({});
  });

  it("supports a custom segment prefix length", () => {
    const plan = planIpAllocation({
      siteSupernet: "10.0.0.0/16",
      devices: [],
      links: [],
      segments: [{ name: "point-to-point-pool", prefixLength: 27 }],
    });
    expect(plan.segments["point-to-point-pool"]!.cidr).toMatch(/\/27$/);
  });

  it("throws a clear error when the mgmt block cannot fit every device", () => {
    expect(() =>
      planIpAllocation({
        siteSupernet: "10.0.0.0/24",
        mgmtPrefixLength: 30, // only 2 usable hosts
        devices: [
          { id: "a", role: "router" },
          { id: "b", role: "router" },
          { id: "c", role: "router" },
        ],
        links: [],
        segments: [],
      }),
    ).toThrow(/Management block/);
  });

  it("L3_CAPABLE_ROLES excludes access-switch and access-point", () => {
    expect(L3_CAPABLE_ROLES.has("access-switch")).toBe(false);
    expect(L3_CAPABLE_ROLES.has("access-point")).toBe(false);
    expect(L3_CAPABLE_ROLES.has("router")).toBe(true);
    expect(L3_CAPABLE_ROLES.has("firewall")).toBe(true);
  });

  it("gives each l3DeviceId its own sequential address after the gateway", () => {
    const plan = planIpAllocation({
      siteSupernet: "10.0.0.0/16",
      devices: [],
      links: [],
      segments: [{ name: "corp-data", l3DeviceIds: ["rtr-01", "rtr-02"] }],
    });
    const segment = plan.segments["corp-data"]!;
    // The mgmt network always claims 10.0.0.0/24 first (even with zero devices), so this
    // segment — the only other thing being allocated — lands at the next block, 10.0.1.0/24.
    expect(segment.gateway).toBe("10.0.1.1");
    expect(segment.deviceIps).toEqual({ "rtr-01": "10.0.1.2", "rtr-02": "10.0.1.3" });
  });

  it("leaves deviceIps empty when a segment has no l3DeviceIds", () => {
    const plan = planIpAllocation({
      siteSupernet: "10.0.0.0/16",
      devices: [],
      links: [],
      segments: [{ name: "corp-data" }],
    });
    expect(plan.segments["corp-data"]!.deviceIps).toEqual({});
  });

  it("throws a clear error when a segment can't fit its gateway plus every l3DeviceId", () => {
    expect(() =>
      planIpAllocation({
        siteSupernet: "10.0.0.0/16",
        devices: [],
        links: [],
        segments: [{ name: "tiny", prefixLength: 30, l3DeviceIds: ["rtr-01", "rtr-02"] }], // /30 has only 2 usable hosts
      }),
    ).toThrow(/has room for 2 host\(s\) but needs 1 \(gateway\) \+ 2/);
  });
});
