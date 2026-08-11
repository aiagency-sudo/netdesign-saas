import type { Design, VendorHint } from "@netdesign/schema";

/**
 * Vendors whose CLI treats `#` as a comment. Everything else gets cisco's `!`.
 * This is the same split the per-vendor banners make (BANNER vs
 * FORTIGATE_BANNER / PANOS_BANNER) — kept in one place so a new vendor only
 * has to be classified once.
 */
const HASH_COMMENT_VENDORS = new Set<VendorHint>(["fortinet-fortigate", "paloalto-panos"]);

/** The comment character for a vendor's CLI: `#` for FortiOS/PAN-OS, `!` for cisco and everything else. */
export function commentPrefixFor(vendorHint: VendorHint): "!" | "#" {
  return HASH_COMMENT_VENDORS.has(vendorHint) ? "#" : "!";
}

const RULE_WIDTH = 60;

/**
 * Joins per-device configs into the single file the web app serves from
 * "Download configs", with a header naming each device.
 *
 * Each header uses **that device's own comment character**. A `!`-prefixed
 * header is a syntax error pasted into a FortiGate or a PAN-OS box, so a
 * mixed-vendor site would otherwise hand the engineer a file whose section
 * markers have to be deleted by hand before the firewall half can be used.
 */
export function combineConfigs(design: Design, configs: Record<string, string>): string {
  const vendorById = new Map(design.devices.map((device) => [device.id, device.vendorHint]));

  return Object.keys(configs)
    .map((deviceId) => {
      const vendorHint = vendorById.get(deviceId);
      const prefix = vendorHint ? commentPrefixFor(vendorHint) : "!";
      const rule = prefix.padEnd(RULE_WIDTH, "=");
      return `${rule}\n${prefix} Device: ${deviceId}\n${rule}\n\n${configs[deviceId]}`;
    })
    .join("\n\n");
}
