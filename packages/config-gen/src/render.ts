import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import type { Design, Device } from "@netdesign/schema";
import { buildRouterView, buildSwitchView } from "./view-models.js";
import { buildFortiGateView } from "./fortigate-view.js";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

const env = nunjucks.configure(TEMPLATES_DIR, { autoescape: false, trimBlocks: true, lstripBlocks: true });

export class UnsupportedDeviceError extends Error {}

/**
 * Renders one device's cisco-ios base config — templates only, no LLM at
 * render time, per CLAUDE.md's hard rule. Only "router" and "access-switch"
 * roles are supported today (this composer's only cisco-ios-capable roles).
 */
export function renderCiscoIosConfig(device: Device, design: Design): string {
  if (device.vendorHint !== "cisco-ios") {
    throw new UnsupportedDeviceError(
      `renderCiscoIosConfig only supports vendorHint "cisco-ios", got "${device.vendorHint}" for device "${device.id}".`,
    );
  }
  if (device.role === "router") {
    return env.render("cisco-ios/router.njk", buildRouterView(device, design));
  }
  if (device.role === "access-switch") {
    return env.render("cisco-ios/access-switch.njk", buildSwitchView(device, design));
  }
  throw new UnsupportedDeviceError(`renderCiscoIosConfig has no cisco-ios template for role "${device.role}" (device "${device.id}").`);
}

/**
 * Renders one device's fortinet-fortigate base config — templates only, no
 * LLM at render time. Only the "firewall" role is supported (the only
 * fortigate-capable role this composer produces). Interfaces + ECMP routing;
 * no firewall policies (see buildFortiGateView).
 */
export function renderFortiGateConfig(device: Device, design: Design): string {
  if (device.vendorHint !== "fortinet-fortigate") {
    throw new UnsupportedDeviceError(
      `renderFortiGateConfig only supports vendorHint "fortinet-fortigate", got "${device.vendorHint}" for device "${device.id}".`,
    );
  }
  if (device.role === "firewall") {
    return env.render("fortinet-fortigate/firewall.njk", buildFortiGateView(device, design));
  }
  throw new UnsupportedDeviceError(
    `renderFortiGateConfig has no fortinet-fortigate template for role "${device.role}" (device "${device.id}").`,
  );
}

/**
 * Renders every device in a design that has both a cisco-ios vendorHint and
 * a supported role. Devices outside that (e.g. this design's Fortinet
 * firewall) are silently skipped, not errored — config-gen only generates
 * configs for vendors/roles it actually has templates for; other vendors
 * are future work (CLAUDE.md's vendor rollout order), not a failure.
 */
export function renderAllConfigs(design: Design): Record<string, string> {
  const configs: Record<string, string> = {};
  for (const device of design.devices) {
    if (device.vendorHint === "cisco-ios" && (device.role === "router" || device.role === "access-switch")) {
      configs[device.id] = renderCiscoIosConfig(device, design);
    } else if (device.vendorHint === "fortinet-fortigate" && device.role === "firewall") {
      configs[device.id] = renderFortiGateConfig(device, design);
    }
  }
  return configs;
}
