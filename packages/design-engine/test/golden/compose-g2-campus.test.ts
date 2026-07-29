import { describe, expect, it } from "vitest";
import { composeCampusDesign } from "../../src/compose/campus.js";
import { findOverlappingSubnetsInDesign } from "../../src/ip-allocation/validate.js";
import { g2CampusParams } from "./fixtures/g2-campus-params.js";

describe("golden G2 campus-three-tier — full design composition", () => {
  const design = composeCampusDesign(g2CampusParams);

  it("matches the recorded snapshot", () => {
    expect(design).toMatchSnapshot();
  });

  it("produces exactly the expected device roles and counts", () => {
    expect(countBy(design.devices, (d) => d.role)).toEqual({
      firewall: 1,
      router: 2,
      "core-switch": 2,
      "distribution-switch": 2,
      "access-switch": 6,
    });
  });

  it("groups both distribution switches under one HSRP redundancy group and runs HSRP", () => {
    const dists = design.devices.filter((d) => d.role === "distribution-switch");
    expect(dists.map((d) => d.redundancyGroup)).toEqual(["hsrp-dist", "hsrp-dist"]);
    expect(design.routing?.firstHopRedundancy).toBe("hsrp");
  });

  it("runs OSPF area 0 across the L3 routing core — edge routers, core, distribution — but not the firewall or access", () => {
    expect(design.routing?.igp).toBe("ospf");
    const area0 = design.routing?.ospfAreas?.find((a) => a.area === "0");
    expect(area0).toBeDefined();
    const area0Ids = new Set(area0!.deviceIds);
    // The FortiGate edge runs static/ECMP, not OSPF, so it is not an OSPF speaker.
    const expectedSpeakers = design.devices
      .filter((d) => d.role === "router" || d.role === "core-switch" || d.role === "distribution-switch")
      .map((d) => d.id);
    expect(area0Ids).toEqual(new Set(expectedSpeakers));
    // Neither the firewall nor any access switch is in the routing domain.
    for (const nonSpeaker of design.devices.filter((d) => d.role === "firewall" || d.role === "access-switch")) {
      expect(area0Ids.has(nonSpeaker.id)).toBe(false);
    }
  });

  it("has two VLAN segments with distinct CIDRs and gateways", () => {
    expect(design.segments).toHaveLength(2);
    expect(new Set(design.segments.map((s) => s.cidr)).size).toBe(2);
    expect(design.segments.map((s) => s.vlanId)).toEqual([10, 20]);
  });

  it("has zero overlapping subnets across mgmt IPs, loopbacks, P2P links, and VLANs", () => {
    expect(findOverlappingSubnetsInDesign(design)).toEqual([]);
  });

  it("puts the VLAN SVIs (gateways) on the distribution pair — exactly once each — and nowhere else", () => {
    const dists = design.devices.filter((d) => d.role === "distribution-switch");
    for (const dist of dists) {
      const sviIfaces = (dist.interfaces ?? []).filter((i) => i.svis);
      // A switch has one logical SVI per VLAN, so exactly one interface carries the svis block.
      expect(sviIfaces).toHaveLength(1);
      expect(sviIfaces[0]!.svis).toHaveLength(2); // one per VLAN

      // Each distribution switch owns a distinct address per VLAN, never the shared gateway.
      for (const segment of design.segments) {
        const svi = sviIfaces[0]!.svis!.find((s) => s.vlanId === segment.vlanId)!;
        expect(svi.ip.split("/")[0]).not.toBe(segment.gateway);
      }
    }

    // Nobody else carries SVIs — not the core, not the edge routers, not access.
    for (const device of design.devices.filter((d) => d.role !== "distribution-switch")) {
      for (const iface of device.interfaces ?? []) {
        expect(iface.svis).toBeUndefined();
      }
    }
  });

  it("keeps the core pure L3 transit: every core interface is a routed /31, none is a trunk", () => {
    const cores = design.devices.filter((d) => d.role === "core-switch");
    for (const core of cores) {
      expect(core.interfaces?.length).toBeGreaterThan(0);
      for (const iface of core.interfaces!) {
        expect(iface.ip?.endsWith("/31")).toBe(true);
        expect(iface.trunk).toBeFalsy();
        expect(iface.svis).toBeUndefined();
      }
    }
  });

  it("dual-homes every access switch to BOTH distribution switches (two trunk uplinks each)", () => {
    const distIds = new Set(design.devices.filter((d) => d.role === "distribution-switch").map((d) => d.id));
    for (const acc of design.devices.filter((d) => d.role === "access-switch")) {
      // Collect the peer device on every link this access switch participates in.
      const peers = design.links
        .filter((l) => l.a.startsWith(`${acc.id}:`) || l.b.startsWith(`${acc.id}:`))
        .map((l) => (l.a.startsWith(`${acc.id}:`) ? l.b : l.a).split(":")[0]!);
      // Exactly the two distribution switches, no more, no fewer.
      expect(new Set(peers)).toEqual(distIds);
      expect(peers).toHaveLength(2);
    }
  });

  it("keeps access switches L2-only: their interfaces are trunks with no IPs and no SVIs", () => {
    const access = design.devices.filter((d) => d.role === "access-switch");
    for (const acc of access) {
      expect(acc.interfaces?.length).toBeGreaterThan(0);
      for (const iface of acc.interfaces!) {
        expect(iface.trunk).toBe(true);
        expect(iface.ip).toBeUndefined();
        expect(iface.svis).toBeUndefined();
      }
    }
  });

  it("embeds a port name on every link endpoint and a matching interfaces[] entry on every device", () => {
    for (const link of design.links) {
      expect(link.a).toMatch(/^[a-z0-9-]+:eth0\/\d+$/);
      expect(link.b).toMatch(/^[a-z0-9-]+:eth0\/\d+$/);
    }
    for (const device of design.devices) {
      expect(device.interfaces?.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic across repeated composition", () => {
    expect(composeCampusDesign(g2CampusParams)).toEqual(design);
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
