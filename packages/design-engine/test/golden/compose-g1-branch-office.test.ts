import { describe, expect, it } from "vitest";
import { composeBranchOfficeDesign } from "../../src/compose/branch-office.js";
import { findOverlappingSubnetsInDesign } from "../../src/ip-allocation/validate.js";
import { g1BranchOfficeParams } from "./fixtures/g1-branch-office-params.js";

describe("golden G1 branch-office — full design composition", () => {
  const design = composeBranchOfficeDesign(g1BranchOfficeParams);

  it("matches the recorded snapshot", () => {
    expect(design).toMatchSnapshot();
  });

  it("produces exactly the expected device roles and counts", () => {
    expect(countBy(design.devices, (d) => d.role)).toEqual({ router: 2, "access-switch": 2, firewall: 1 });
  });

  it("groups both routers under one HSRP redundancy group", () => {
    const routers = design.devices.filter((d) => d.role === "router");
    expect(routers.map((r) => r.redundancyGroup)).toEqual(["hsrp-1", "hsrp-1"]);
    expect(design.routing?.firstHopRedundancy).toBe("hsrp");
  });

  it("has three VLAN segments with distinct /24s", () => {
    expect(design.segments).toHaveLength(3);
    expect(new Set(design.segments.map((s) => s.cidr)).size).toBe(3);
    expect(design.segments.map((s) => s.vlanId)).toEqual([10, 20, 30]);
  });

  it("has zero overlapping subnets across mgmt IPs, loopbacks, P2P links, and VLANs", () => {
    expect(findOverlappingSubnetsInDesign(design)).toEqual([]);
  });

  it("embeds a port name on every link endpoint and a matching interfaces[] entry on every device", () => {
    for (const link of design.links) {
      expect(link.a).toMatch(/^[a-z0-9-]+:eth0\/\d+$/);
      expect(link.b).toMatch(/^[a-z0-9-]+:eth0\/\d+$/);
    }
    for (const device of design.devices) {
      expect(device.interfaces?.length).toBeGreaterThan(0);
    }
    // fw-01 has 2 P2P uplinks (to rtr-01, rtr-02) — both should carry a /31 IP, no trunk.
    const fw = design.devices.find((d) => d.id === "fw-01")!;
    expect(fw.interfaces).toHaveLength(2);
    expect(fw.interfaces!.every((i) => i.ip?.endsWith("/31") && !i.trunk)).toBe(true);
  });

  it("is deterministic across repeated composition", () => {
    expect(composeBranchOfficeDesign(g1BranchOfficeParams)).toEqual(design);
  });
});

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
