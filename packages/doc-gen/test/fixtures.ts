import { composeBranchOfficeDesign } from "@netdesign/design-engine";
import { designParamsSchema } from "@netdesign/schema";

/**
 * Same G1/G4 golden scenarios used throughout the repo, re-declared rather
 * than imported from design-engine's test/ folder — test-only code from one
 * package shouldn't be a runtime or dev dependency of another package's tests.
 */
export const g1Design = composeBranchOfficeDesign(
  designParamsSchema.parse({
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
  }),
);

export const g4Design = composeBranchOfficeDesign(
  designParamsSchema.parse({
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
  }),
);
