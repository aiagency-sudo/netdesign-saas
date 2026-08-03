import type { ParsedDevice, RoleInference } from "./types.js";

/**
 * Infers a device's role from what its config actually contains. Every branch
 * returns the evidence it used, because a role is an INTERPRETATION of the
 * upload, not a fact in it — the reason is surfaced as an assumption so the
 * engineer can correct it rather than silently trusting us.
 *
 * Ordered most-specific first. The shape of a config is genuinely diagnostic:
 *  - SVIs + L2 trunks + routing  -> the L3 boundary for those VLANs (distribution)
 *  - routed ports only + routing, no VLANs -> pure L3 transit (core)
 *  - L2 trunks/access ports, no routing -> access switch
 *  - routed ports + a default route, no switchports -> router
 */
export function inferRole(device: ParsedDevice): RoleInference {
  const svis = device.interfaces.filter((iface) => iface.sviVlanId !== undefined && iface.ip);
  const subinterfaceVlans = device.interfaces.filter((iface) => iface.encapsulationVlanId !== undefined);
  const trunks = device.interfaces.filter((iface) => iface.trunk);
  const accessPorts = device.interfaces.filter((iface) => iface.accessVlan !== undefined);
  const routedPorts = device.interfaces.filter(
    (iface) => iface.ip && iface.sviVlanId === undefined && iface.encapsulationVlanId === undefined,
  );
  const hasSwitchports = trunks.length > 0 || accessPorts.length > 0;
  const hasRouting = device.ipRoutingEnabled || device.ospf !== undefined || device.staticRoutes.length > 0;
  const hasDefaultRoute = device.staticRoutes.some((route) => route.prefix === "0.0.0.0");

  if (svis.length > 0 && trunks.length > 0) {
    return {
      role: "distribution-switch",
      reason: `has ${svis.length} routed SVI${svis.length === 1 ? "" : "s"} and ${trunks.length} L2 trunk${trunks.length === 1 ? "" : "s"}, so it is the layer-3 boundary for those VLANs`,
    };
  }

  if (svis.length > 0) {
    return {
      role: "distribution-switch",
      reason: `has ${svis.length} routed SVI${svis.length === 1 ? "" : "s"} but no L2 trunks in this config`,
    };
  }

  // Router-on-a-stick: dot1Q subinterfaces carrying the VLAN gateways.
  if (subinterfaceVlans.length > 0) {
    return {
      role: "router",
      reason: `has ${subinterfaceVlans.length} dot1Q subinterface${subinterfaceVlans.length === 1 ? "" : "s"} acting as VLAN gateways (router-on-a-stick)`,
    };
  }

  if (!hasSwitchports && routedPorts.length > 0 && device.ipRoutingEnabled && device.ospf) {
    return {
      role: "core-switch",
      reason: `has ip routing, ${routedPorts.length} routed interfaces and OSPF, with no switchports or SVIs — pure layer-3 transit`,
    };
  }

  if (!hasSwitchports && routedPorts.length > 0 && hasDefaultRoute) {
    return {
      role: "router",
      reason: `has ${routedPorts.length} routed interfaces and a default route, with no switchports`,
    };
  }

  if (hasSwitchports && !hasRouting) {
    return {
      role: "access-switch",
      reason: `has ${trunks.length} trunk and ${accessPorts.length} access port${accessPorts.length === 1 ? "" : "s"} with no routing enabled — layer-2 only`,
    };
  }

  if (routedPorts.length > 0) {
    return { role: "router", reason: `has ${routedPorts.length} routed interfaces` };
  }

  if (hasSwitchports) {
    return { role: "access-switch", reason: "has switchports but no layer-3 configuration" };
  }

  return { role: "generic", reason: "the config had no addressing, switchport or routing lines to classify it" };
}

/** Lowercase kebab-case device id derived from the hostname, matching the schema's id rule. */
export function toDeviceId(hostname: string, taken: Set<string>): string {
  const base =
    hostname
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device";
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}
