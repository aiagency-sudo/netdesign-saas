import { designParamsSchema, type DesignParams } from "@netdesign/schema";

/**
 * Golden scenario G1 (CLAUDE.md): branch-office —
 * 2 routers (HSRP), 2 access switches, 1 firewall, 3 VLANs, /24s.
 *
 * This is the design-params-level counterpart to
 * `../../golden/fixtures/g1-branch-office.ts` (which fixtures the
 * ip-allocation module directly) — this one feeds the full composer.
 */
export const g1BranchOfficeParams: DesignParams = designParamsSchema.parse({
  designPattern: "branch-office",
  siteName: "G1 Branch Office",
  intentSummary:
    "Branch office with dual HSRP routers, two access switches, and an edge firewall serving three VLANs.",
  siteSupernet: "10.30.0.0/16",
  router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
  accessSwitch: { count: 2, vendorHint: "cisco-ios" },
  firewall: { present: true, vendorHint: "fortinet-fortigate" },
  vlans: [
    { name: "corp-data", purpose: "user", dhcp: true },
    { name: "voice", purpose: "voice", dhcp: true },
    { name: "guest", purpose: "guest", dhcp: true },
  ],
  assumptions: [],
});
