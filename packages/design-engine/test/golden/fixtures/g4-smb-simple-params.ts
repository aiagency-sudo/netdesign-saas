import { designParamsSchema, type DesignParams } from "@netdesign/schema";

/**
 * Golden scenario G4 (CLAUDE.md): smb-simple —
 * 1 router, 1 switch, 1 firewall, guest + corp VLANs.
 */
export const g4SmbSimpleParams: DesignParams = designParamsSchema.parse({
  designPattern: "smb-flat",
  siteName: "G4 Small Office",
  intentSummary: "Single-router SMB design with one access switch and an edge firewall serving corp and guest VLANs.",
  siteSupernet: "10.40.0.0/16",
  router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
  accessSwitch: { count: 1, vendorHint: "cisco-ios" },
  firewall: { present: true, vendorHint: "fortinet-fortigate" },
  vlans: [
    { name: "corp", purpose: "user", dhcp: true },
    { name: "guest", purpose: "guest", dhcp: true },
  ],
  assumptions: [],
});
