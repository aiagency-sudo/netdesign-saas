import type { Design, DesignParams, DeviceRole, VendorHint } from "@netdesign/schema";
import { parseDesign } from "@netdesign/schema";
import { parseCidr } from "../ip-allocation/cidr.js";
import { planIpAllocation } from "../ip-allocation/plan.js";
import { mustGet } from "../util.js";
import { assignInterfaces, assignVlanIds, idsFor, type LogicalLink, type VlanSviInfo } from "./shared.js";

const DEFAULT_SITE_SUPERNET = "10.20.0.0/16";
const DEFAULT_CORE_COUNT = 2;
const DEFAULT_DIST_COUNT = 2;

/**
 * Composes a full, schema-valid design JSON for the "campus-three-tier"
 * pattern (CLAUDE.md golden G2): a textbook three-tier campus —
 *
 *   [firewall?] → [edge router(s)] → [core pair] → [distribution pair] → [access]
 *
 * with the L3 boundary on **distribution**: SVIs + HSRP on the distribution
 * pair are the VLAN gateways; the core pair is pure L3 transit (routed /31
 * links, OSPF); access switches are L2, dual-homed to both distribution
 * switches. HSRP L2 adjacency between the distribution pair is provided
 * through the access layer (each access switch trunks to both distribution
 * switches), exactly as the branch composer forms it through the
 * access-switch interlink — so no direct distribution peer link is modeled in
 * this first cut. SVIs land on distribution automatically: they're the only
 * L3-capable devices holding an L2 trunk to the access layer (see
 * shared.assignInterfaces).
 *
 * Always returns a schema-validated {@link Design} (via parseDesign) or throws.
 */
export function composeCampusDesign(params: DesignParams): Design {
  if (params.designPattern !== "campus-three-tier") {
    throw new Error(`composeCampusDesign only supports designPattern "campus-three-tier", got "${params.designPattern}".`);
  }

  const assumptions = [...params.assumptions];

  const firewallId = params.firewall.present ? "fw-01" : null;
  const routerIds = idsFor("rtr", params.router.count);
  const coreIds = idsFor("core", params.coreSwitch?.count ?? DEFAULT_CORE_COUNT);
  const distIds = idsFor("dist", params.distributionSwitch?.count ?? DEFAULT_DIST_COUNT);
  const accessIds = idsFor("acc", params.accessSwitch.count);
  const wlcId = params.wirelessController?.present ? "wlc-01" : null;
  const managedDeviceIds = [
    ...(firewallId ? [firewallId] : []),
    ...routerIds,
    ...coreIds,
    ...distIds,
    ...accessIds,
    ...(wlcId ? [wlcId] : []),
  ];

  const roleById = new Map<string, DeviceRole>();
  if (firewallId) roleById.set(firewallId, "firewall");
  routerIds.forEach((id) => roleById.set(id, "router"));
  coreIds.forEach((id) => roleById.set(id, "core-switch"));
  distIds.forEach((id) => roleById.set(id, "distribution-switch"));
  accessIds.forEach((id) => roleById.set(id, "access-switch"));
  if (wlcId) roleById.set(wlcId, "wireless-controller");

  const vendorHintById = new Map<string, VendorHint>();
  if (firewallId) vendorHintById.set(firewallId, params.firewall.vendorHint);
  routerIds.forEach((id) => vendorHintById.set(id, params.router.vendorHint));
  coreIds.forEach((id) => vendorHintById.set(id, params.coreSwitch?.vendorHint ?? "cisco-ios"));
  distIds.forEach((id) => vendorHintById.set(id, params.distributionSwitch?.vendorHint ?? "cisco-ios"));
  accessIds.forEach((id) => vendorHintById.set(id, params.accessSwitch.vendorHint));
  if (wlcId) vendorHintById.set(wlcId, params.wirelessController?.vendorHint ?? "cisco-ios");

  const logicalLinks = buildCampusLinks({ firewallId, routerIds, coreIds, distIds, accessIds, wlcId });
  const vlanIds = assignVlanIds(params.vlans);

  const siteSupernet = params.siteSupernet ?? DEFAULT_SITE_SUPERNET;
  if (!params.siteSupernet) {
    assumptions.push(`No site address range was specified; assumed ${DEFAULT_SITE_SUPERNET}.`);
  }

  if (wlcId) {
    assumptions.push(
      `The wireless controller (${wlcId}) is trunked to both distribution switches and managed from the management network; ` +
        "access points, RF/site survey and WLAN-to-VLAN mapping are not modeled.",
    );
  }

  // VLAN gateways are HSRP SVIs on the distribution pair, so both distribution
  // switches need their own per-VLAN address distinct from the shared virtual
  // IP (the gateway). This is exactly the branch HSRP-router pattern, just on
  // the distribution switches.
  const distIsRedundant = distIds.length > 1;
  const segmentL3DeviceIds = distIsRedundant ? distIds : [];

  const plan = planIpAllocation({
    siteSupernet,
    devices: managedDeviceIds.map((id) => ({ id, role: mustGet(roleById, id, "device role") })),
    links: logicalLinks.map((link) => ({ id: link.id, a: link.a, b: link.b, kind: link.kind })),
    segments: params.vlans.map((vlan) => ({ name: vlan.name, l3DeviceIds: segmentL3DeviceIds })),
  });

  const vlanSvis: VlanSviInfo[] = params.vlans.map((vlan) => {
    const allocation = mustGet(plan.segments, vlan.name, "VLAN segment allocation");
    const { prefixLength } = parseCidr(allocation.cidr);
    return {
      vlanId: mustGet(vlanIds, vlan.name, "VLAN id"),
      prefixLength,
      gateway: allocation.gateway,
      deviceIps: allocation.deviceIps,
    };
  });

  const { linkInterfaces, interfacesByDevice } = assignInterfaces(logicalLinks, plan.p2pLinks, vlanSvis, roleById);

  const devices = managedDeviceIds.map((id) => {
    const role = mustGet(roleById, id, "device role");
    const loopback = plan.loopbacks[id];
    const isRedundantDist = role === "distribution-switch" && distIsRedundant;
    const interfaces = interfacesByDevice.get(id);
    return {
      id,
      hostname: id,
      role,
      vendorHint: mustGet(vendorHintById, id, "vendor hint"),
      mgmtIp: mustGet(plan.mgmt.deviceIps, id, "mgmt IP"),
      ...(loopback ? { loopback } : {}),
      ...(isRedundantDist ? { redundancyGroup: "hsrp-dist" } : {}),
      ...(interfaces && interfaces.length > 0 ? { interfaces } : {}),
    };
  });

  const links = logicalLinks.map((link) => {
    const p2p = plan.p2pLinks[link.id];
    const { ifaceA, ifaceB } = mustGet(linkInterfaces, link.id, "link interface assignment");
    return {
      a: `${link.a}:${ifaceA}`,
      b: `${link.b}:${ifaceB}`,
      kind: link.kind,
      label: link.label,
      ...(p2p ? { subnet: p2p.cidr } : {}),
    };
  });

  const segments = params.vlans.map((vlan) => {
    const allocation = mustGet(plan.segments, vlan.name, "VLAN segment allocation");
    return {
      name: vlan.name,
      vlanId: mustGet(vlanIds, vlan.name, "VLAN id"),
      cidr: allocation.cidr,
      gateway: allocation.gateway,
      purpose: vlan.purpose,
      dhcp: vlan.dhcp,
    };
  });

  // OSPF area 0 across the L3 routing core (edge routers, core, distribution).
  // The firewall is deliberately NOT an OSPF speaker: the FortiGate edge runs
  // static/ECMP routing (see config-gen's fortigate-view), so the edge routers
  // treat their firewall-facing link as a passive OSPF interface — the subnet
  // is advertised, but no adjacency is attempted toward the firewall.
  const ospfDeviceIds = managedDeviceIds.filter((id) => {
    const role = mustGet(roleById, id, "device role");
    return role === "router" || role === "core-switch" || role === "distribution-switch";
  });

  const rawDesign = {
    version: "1.0" as const,
    meta: {
      name: params.siteName,
      intentSummary: params.intentSummary,
      designPattern: params.designPattern,
      assumptions,
      warnings: [],
    },
    devices,
    links,
    segments,
    routing: {
      igp: "ospf" as const,
      ospfAreas: [{ area: "0", deviceIds: ospfDeviceIds }],
      firstHopRedundancy: distIsRedundant ? ("hsrp" as const) : ("none" as const),
      defaultRoute: "0.0.0.0/0",
    },
  };

  return parseDesign(rawDesign);
}

function buildCampusLinks(input: {
  firewallId: string | null;
  routerIds: string[];
  coreIds: string[];
  distIds: string[];
  accessIds: string[];
  wlcId: string | null;
}): LogicalLink[] {
  const links: LogicalLink[] = [];

  // firewall <-> each edge router (reuse the branch edge)
  if (input.firewallId) {
    for (const routerId of input.routerIds) {
      links.push({ id: `${input.firewallId}--${routerId}`, a: input.firewallId, b: routerId, kind: "ethernet", label: "Firewall uplink" });
    }
  }

  // each edge router dual-homed to both cores (routed)
  for (const routerId of input.routerIds) {
    for (const coreId of input.coreIds) {
      links.push({ id: `${routerId}--${coreId}`, a: routerId, b: coreId, kind: "ethernet", label: "Core uplink" });
    }
  }

  // core peer link(s) (routed L3 backbone)
  for (let i = 0; i < input.coreIds.length - 1; i++) {
    const a = input.coreIds[i]!;
    const b = input.coreIds[i + 1]!;
    links.push({ id: `${a}--${b}`, a, b, kind: "ethernet", label: "Core peer link" });
  }

  // each distribution switch dual-homed to both cores (routed)
  for (const distId of input.distIds) {
    for (const coreId of input.coreIds) {
      links.push({ id: `${distId}--${coreId}`, a: distId, b: coreId, kind: "ethernet", label: "Distribution uplink" });
    }
  }

  // each access switch dual-homed to both distribution switches (L2 trunks)
  for (const accessId of input.accessIds) {
    for (const distId of input.distIds) {
      links.push({ id: `${accessId}--${distId}`, a: accessId, b: distId, kind: "ethernet", label: "Access trunk" });
    }
  }

  // Wireless controller trunked to both distribution switches. Deliberately
  // LAST: assignInterfaces anchors a distribution switch's SVIs to the first
  // trunk it is given, and those SVIs belong on the access-facing trunk.
  if (input.wlcId) {
    for (const distId of input.distIds) {
      links.push({
        id: `${input.wlcId}--${distId}`,
        a: input.wlcId,
        b: distId,
        kind: "ethernet",
        label: "Wireless controller trunk",
      });
    }
  }

  return links;
}
