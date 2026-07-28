import type { Design, DesignParams, DeviceRole, VendorHint } from "@netdesign/schema";
import { parseDesign } from "@netdesign/schema";
import { parseCidr } from "../ip-allocation/cidr.js";
import { planIpAllocation } from "../ip-allocation/plan.js";
import { mustGet } from "../util.js";
import { assignInterfaces, assignVlanIds, idsFor, type LogicalLink, type VlanSviInfo } from "./shared.js";

const DEFAULT_SITE_SUPERNET = "10.0.0.0/16";
const SUPPORTED_PATTERNS = new Set<DesignParams["designPattern"]>(["branch-office", "smb-flat"]);

/**
 * Composes a full, schema-valid design JSON from design-params for the
 * "branch-office" and "smb-flat" patterns — the same underlying topology
 * shape (N redundant routers, M access switches, an optional edge firewall,
 * a flat set of VLANs) parametrized differently. Golden scenarios G1
 * (branch-office) and G4 (smb-flat) are both this shape.
 *
 * Always returns a schema-validated {@link Design} (via parseDesign) or
 * throws — per CLAUDE.md hard rule 1, generated designs must validate
 * before anything downstream touches them.
 */
export function composeBranchOfficeDesign(params: DesignParams): Design {
  if (!SUPPORTED_PATTERNS.has(params.designPattern)) {
    throw new Error(
      `composeBranchOfficeDesign only supports designPattern "branch-office" or "smb-flat", got "${params.designPattern}".`,
    );
  }

  const assumptions = [...params.assumptions];

  const routerIds = idsFor("rtr", params.router.count);
  const switchIds = idsFor("sw", params.accessSwitch.count);
  const firewallId = params.firewall.present ? "fw-01" : null;
  const managedDeviceIds = [...routerIds, ...switchIds, ...(firewallId ? [firewallId] : [])];

  const roleById = new Map<string, DeviceRole>();
  routerIds.forEach((id) => roleById.set(id, "router"));
  switchIds.forEach((id) => roleById.set(id, "access-switch"));
  if (firewallId) roleById.set(firewallId, "firewall");

  const vendorHintById = new Map<string, VendorHint>();
  routerIds.forEach((id) => vendorHintById.set(id, params.router.vendorHint));
  switchIds.forEach((id) => vendorHintById.set(id, params.accessSwitch.vendorHint));
  if (firewallId) vendorHintById.set(firewallId, params.firewall.vendorHint);

  const logicalLinks = buildLogicalLinks({ routerIds, switchIds, firewallId });
  const vlanIds = assignVlanIds(params.vlans);

  const siteSupernet = params.siteSupernet ?? DEFAULT_SITE_SUPERNET;
  if (!params.siteSupernet) {
    assumptions.push(`No site address range was specified; assumed ${DEFAULT_SITE_SUPERNET}.`);
  }
  if (params.router.count > 1 && params.router.redundancy === "none") {
    assumptions.push(
      "Multiple routers were requested with no redundancy protocol specified; they are not configured as an HSRP/VRRP pair.",
    );
  }

  // Every router trunks every VLAN in this composer's topology (assignInterfaces below),
  // so when there's more than one router they all need their own distinct address on each
  // VLAN (e.g. an HSRP pair's individual subinterface IPs, distinct from the shared virtual
  // IP). With exactly one router there's no ambiguity — its own address is just the segment
  // gateway — so no separate per-device allocation is needed at all.
  const l3DeviceIds = routerIds.length > 1 ? routerIds : [];

  const plan = planIpAllocation({
    siteSupernet,
    devices: managedDeviceIds.map((id) => ({ id, role: mustGet(roleById, id, "device role") })),
    links: logicalLinks.map((link) => ({ id: link.id, a: link.a, b: link.b, kind: link.kind })),
    segments: params.vlans.map((vlan) => ({ name: vlan.name, l3DeviceIds })),
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
    const isRedundantRouter = role === "router" && params.router.count > 1 && params.router.redundancy !== "none";
    const interfaces = interfacesByDevice.get(id);
    return {
      id,
      hostname: id,
      role,
      vendorHint: mustGet(vendorHintById, id, "vendor hint"),
      mgmtIp: mustGet(plan.mgmt.deviceIps, id, "mgmt IP"),
      ...(loopback ? { loopback } : {}),
      ...(isRedundantRouter ? { redundancyGroup: "hsrp-1" } : {}),
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
      igp: "static" as const,
      firstHopRedundancy: params.router.count > 1 ? params.router.redundancy : "none",
      defaultRoute: "0.0.0.0/0",
    },
  };

  return parseDesign(rawDesign);
}

function buildLogicalLinks(input: { routerIds: string[]; switchIds: string[]; firewallId: string | null }): LogicalLink[] {
  const links: LogicalLink[] = [];

  if (input.firewallId) {
    for (const routerId of input.routerIds) {
      links.push({
        id: `${input.firewallId}--${routerId}`,
        a: input.firewallId,
        b: routerId,
        kind: "ethernet",
        label: "Firewall uplink",
      });
    }
  }

  // Each switch uplinks to a router in round-robin order, so switchCount and
  // routerCount don't need to match (e.g. two floors, one router).
  input.switchIds.forEach((switchId, index) => {
    const routerId = input.routerIds[index % input.routerIds.length]!; // modulo keeps this in range
    links.push({ id: `${routerId}--${switchId}`, a: routerId, b: switchId, kind: "ethernet", label: "Access trunk" });
  });

  for (let i = 0; i < input.switchIds.length - 1; i++) {
    const a = input.switchIds[i]!;
    const b = input.switchIds[i + 1]!;
    links.push({ id: `${a}--${b}`, a, b, kind: "port-channel", label: "Switch interlink" });
  }

  return links;
}
