import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import type { Design, Device } from "@netdesign/schema";
import {
  buildCoreSwitchView,
  buildDistributionSwitchView,
  buildRouterView,
  buildSwitchView,
} from "./view-models.js";
import { buildFortiGateView } from "./fortigate-view.js";
import { buildPanOsView } from "./panos-view.js";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

const env = nunjucks.configure(TEMPLATES_DIR, { autoescape: false, trimBlocks: true, lstripBlocks: true });

export class UnsupportedDeviceError extends Error {}

/**
 * Renders one device's cisco-ios base config — templates only, no LLM at
 * render time, per CLAUDE.md's hard rule. Supported roles: "router" and
 * "access-switch" (branch/SMB) plus "distribution-switch" and "core-switch"
 * (the campus three-tier L3 fabric).
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
  if (device.role === "distribution-switch") {
    return env.render("cisco-ios/distribution-switch.njk", buildDistributionSwitchView(device, design));
  }
  if (device.role === "core-switch") {
    return env.render("cisco-ios/core-switch.njk", buildCoreSwitchView(device, design));
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
 * Renders one device's paloalto-panos base config in `set` format — templates
 * only, no LLM at render time. Only the "firewall" role is supported (the
 * only PAN-OS-capable role this composer produces). Interfaces + zones +
 * static routing; no security policies and no NAT (see buildPanOsView).
 */
export function renderPanOsConfig(device: Device, design: Design): string {
  if (device.vendorHint !== "paloalto-panos") {
    throw new UnsupportedDeviceError(
      `renderPanOsConfig only supports vendorHint "paloalto-panos", got "${device.vendorHint}" for device "${device.id}".`,
    );
  }
  if (device.role === "firewall") {
    return env.render("paloalto-panos/firewall.njk", buildPanOsView(device, design));
  }
  throw new UnsupportedDeviceError(
    `renderPanOsConfig has no paloalto-panos template for role "${device.role}" (device "${device.id}").`,
  );
}

/**
 * Renders every device in a design whose vendorHint + role combination has a
 * template. Devices outside that set are silently skipped, not errored —
 * config-gen only generates configs for vendors/roles it actually has
 * templates for; the remaining vendors are future work (CLAUDE.md's vendor
 * rollout order), not a failure.
 */
const CISCO_IOS_ROLES = new Set<Device["role"]>(["router", "access-switch", "distribution-switch", "core-switch"]);

export function renderAllConfigs(design: Design): Record<string, string> {
  const configs: Record<string, string> = {};
  for (const device of design.devices) {
    if (device.vendorHint === "cisco-ios" && CISCO_IOS_ROLES.has(device.role)) {
      configs[device.id] = renderCiscoIosConfig(device, design);
    } else if (device.vendorHint === "fortinet-fortigate" && device.role === "firewall") {
      configs[device.id] = renderFortiGateConfig(device, design);
    } else if (device.vendorHint === "paloalto-panos" && device.role === "firewall") {
      configs[device.id] = renderPanOsConfig(device, design);
    }
  }
  return configs;
}
