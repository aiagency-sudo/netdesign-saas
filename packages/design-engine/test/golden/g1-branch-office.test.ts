import { describe, expect, it } from "vitest";
import { planIpAllocation } from "../../src/ip-allocation/plan.js";
import { findOverlappingPairs, flattenPlanCidrs } from "../../src/ip-allocation/validate.js";
import { g1BranchOffice } from "./fixtures/g1-branch-office.js";

describe("golden G1 branch-office — IP allocation", () => {
  const plan = planIpAllocation(g1BranchOffice);

  it("produces zero overlapping subnets across mgmt, loopbacks, P2P links, and VLANs", () => {
    const cidrs = flattenPlanCidrs(plan);
    // mgmt + 3 loopbacks + 2 p2p links + 3 vlan segments
    expect(cidrs).toHaveLength(1 + 3 + 2 + 3);
    expect(findOverlappingPairs(cidrs)).toEqual([]);
  });

  it("assigns a /24 mgmt network with sequential device IPs", () => {
    expect(plan.mgmt.cidr).toBe("10.30.0.0/24");
    expect(plan.mgmt.gateway).toBe("10.30.0.1");
    expect(plan.mgmt.deviceIps).toEqual({
      "fw-01": "10.30.0.2",
      "rtr-01": "10.30.0.3",
      "rtr-02": "10.30.0.4",
      "sw-01": "10.30.0.5",
      "sw-02": "10.30.0.6",
    });
  });

  it("assigns a /32 loopback to the firewall and both routers only — not the access switches", () => {
    expect(plan.loopbacks).toEqual({
      "fw-01": "10.30.1.0/32",
      "rtr-01": "10.30.1.1/32",
      "rtr-02": "10.30.1.2/32",
    });
  });

  it("assigns /31s only to the firewall<->router links, never the switch trunks, the switch interlink, or the WAN hop", () => {
    expect(Object.keys(plan.p2pLinks).sort()).toEqual(["fw01-rtr01", "fw01-rtr02"]);
    expect(plan.p2pLinks["fw01-rtr01"]).toEqual({ cidr: "10.30.1.4/31", ipA: "10.30.1.4", ipB: "10.30.1.5" });
    expect(plan.p2pLinks["fw01-rtr02"]).toEqual({ cidr: "10.30.1.6/31", ipA: "10.30.1.6", ipB: "10.30.1.7" });
  });

  it("assigns a /24 with a usable gateway to each of the 3 VLANs", () => {
    expect(plan.segments["corp-data"]).toEqual({ cidr: "10.30.2.0/24", gateway: "10.30.2.1", deviceIps: {} });
    expect(plan.segments["voice"]).toEqual({ cidr: "10.30.3.0/24", gateway: "10.30.3.1", deviceIps: {} });
    expect(plan.segments["guest"]).toEqual({ cidr: "10.30.4.0/24", gateway: "10.30.4.1", deviceIps: {} });
  });

  it("is deterministic across repeated runs on the same fixture", () => {
    expect(planIpAllocation(g1BranchOffice)).toEqual(planIpAllocation(g1BranchOffice));
  });
});
