import { designParamsSchema, type DesignParams } from "@netdesign/schema";

/**
 * Golden scenario G2 (CLAUDE.md): campus — collapsed distribution over a pure
 * L3 core, 6 access switches, a voice VLAN. Textbook three-tier:
 *
 *   [firewall] → [HSRP edge routers] → [L3 core pair] → [L3 distribution pair] → [L2 access]
 *
 * The L3 boundary lives on the distribution pair (SVIs + HSRP are the VLAN
 * gateways); the core is pure L3 transit. Wireless controller is deferred
 * (CLAUDE.md scope), so this first cut is corp-data + voice.
 */
export const g2CampusParams: DesignParams = designParamsSchema.parse({
  designPattern: "campus-three-tier",
  siteName: "G2 Campus",
  intentSummary:
    "Three-tier campus: HSRP edge routers behind a firewall, a pure-L3 core pair, an HSRP distribution pair as VLAN gateways, and six L2 access switches serving corp-data and voice.",
  siteSupernet: "10.20.0.0/16",
  router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
  accessSwitch: { count: 6, vendorHint: "cisco-ios" },
  firewall: { present: true, vendorHint: "fortinet-fortigate" },
  coreSwitch: { count: 2, vendorHint: "cisco-ios" },
  distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
  vlans: [
    { name: "corp-data", purpose: "user", dhcp: true },
    { name: "voice", purpose: "voice", dhcp: true },
  ],
  assumptions: [],
});
