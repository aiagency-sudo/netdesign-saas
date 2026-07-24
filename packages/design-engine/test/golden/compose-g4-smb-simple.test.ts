import { describe, expect, it } from "vitest";
import { composeBranchOfficeDesign } from "../../src/compose/branch-office.js";
import { findOverlappingSubnetsInDesign } from "../../src/ip-allocation/validate.js";
import { g4SmbSimpleParams } from "./fixtures/g4-smb-simple-params.js";

describe("golden G4 smb-simple — full design composition", () => {
  const design = composeBranchOfficeDesign(g4SmbSimpleParams);

  it("matches the recorded snapshot", () => {
    expect(design).toMatchSnapshot();
  });

  it("produces exactly the expected device roles and counts", () => {
    expect(countBy(design.devices, (d) => d.role)).toEqual({ router: 1, "access-switch": 1, firewall: 1 });
  });

  it("does not assign a redundancy group when there is only one router", () => {
    const router = design.devices.find((d) => d.role === "router");
    expect(router?.redundancyGroup).toBeUndefined();
    expect(design.routing?.firstHopRedundancy).toBe("none");
  });

  it("has two VLAN segments (corp, guest) with distinct /24s", () => {
    expect(design.segments).toHaveLength(2);
    expect(design.segments.map((s) => s.name)).toEqual(["corp", "guest"]);
    expect(new Set(design.segments.map((s) => s.cidr)).size).toBe(2);
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
    const sw = design.devices.find((d) => d.id === "sw-01")!;
    expect(sw.interfaces).toHaveLength(1);
    expect(sw.interfaces![0]!.trunk).toBe(true);
    expect(sw.interfaces![0]!.allowedVlans).toEqual([10, 20]);
  });

  it("is deterministic across repeated composition", () => {
    expect(composeBranchOfficeDesign(g4SmbSimpleParams)).toEqual(design);
  });

  it("gives the single router its own svis equal to each VLAN's gateway (no HSRP pair, no separate address needed)", () => {
    const router = design.devices.find((d) => d.role === "router")!;
    const trunk = router.interfaces!.find((i) => i.trunk)!;
    expect(trunk.svis).toHaveLength(2); // one per VLAN

    for (const segment of design.segments) {
      const svi = trunk.svis!.find((s) => s.vlanId === segment.vlanId)!;
      expect(svi.ip.split("/")[0]).toBe(segment.gateway);
    }
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
