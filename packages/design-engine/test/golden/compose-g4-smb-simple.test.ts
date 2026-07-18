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

  it("is deterministic across repeated composition", () => {
    expect(composeBranchOfficeDesign(g4SmbSimpleParams)).toEqual(design);
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
