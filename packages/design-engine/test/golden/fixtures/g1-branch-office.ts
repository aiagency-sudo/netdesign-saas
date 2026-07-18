import type { IpAllocationInput } from "../../../src/ip-allocation/plan.js";

/**
 * Golden scenario G1 (CLAUDE.md): branch-office —
 * 2 routers (HSRP), 2 access switches, 1 firewall, 3 VLANs, /24s.
 *
 * fw-01 is the WAN edge, dual-homed to rtr-01/rtr-02 for router redundancy.
 * Each router trunks down to its own access switch; the switches are
 * interlinked. The ISP hop is deliberately outside the device list — it's
 * not ours to address.
 */
export const g1BranchOffice: IpAllocationInput = {
  siteSupernet: "10.30.0.0/16",
  devices: [
    { id: "fw-01", role: "firewall" },
    { id: "rtr-01", role: "router" },
    { id: "rtr-02", role: "router" },
    { id: "sw-01", role: "access-switch" },
    { id: "sw-02", role: "access-switch" },
  ],
  links: [
    { id: "fw01-rtr01", a: "fw-01", b: "rtr-01", kind: "ethernet" },
    { id: "fw01-rtr02", a: "fw-01", b: "rtr-02", kind: "ethernet" },
    { id: "rtr01-sw01", a: "rtr-01", b: "sw-01", kind: "ethernet" },
    { id: "rtr02-sw02", a: "rtr-02", b: "sw-02", kind: "ethernet" },
    { id: "sw01-sw02", a: "sw-01", b: "sw-02", kind: "port-channel" },
    { id: "fw01-isp", a: "fw-01", b: "isp-edge", kind: "wan" },
  ],
  segments: [{ name: "corp-data" }, { name: "voice" }, { name: "guest" }],
};
