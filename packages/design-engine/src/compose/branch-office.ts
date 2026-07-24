import type { Design, DesignParams, DesignParamsVlan, DeviceRole, Interface, VendorHint } from "@netdesign/schema";
import { parseDesign } from "@netdesign/schema";
import { parseCidr } from "../ip-allocation/cidr.js";
import { L3_CAPABLE_ROLES, planIpAllocation, type P2pLinkAllocation } from "../ip-allocation/plan.js";
import { mustGet } from "../util.js";

const DEFAULT_SITE_SUPERNET = "10.0.0.0/16";
const SUPPORTED_PATTERNS = new Set<DesignParams["designPattern"]>(["branch-office", "smb-flat"]);

interface LogicalLink {
  id: string;
  a: string;
  b: string;
  kind: "ethernet" | "port-channel";
  label: string;
}

/** A VLAN's addressing info needed to build each L3-capable device's per-VLAN subinterface (svis). */
interface VlanSviInfo {
  vlanId: number;
  prefixLength: number;
  gateway: string;
  /** deviceId -> that device's own address on this VLAN (only devices that needed one distinct from the gateway — see IpAllocationSegmentInput.l3DeviceIds). */
  deviceIps: Record<string, string>;
}

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

function idsFor(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
}

function assignVlanIds(vlans: DesignParamsVlan[]): Record<string, number> {
  const result: Record<string, number> = {};
  vlans.forEach((vlan, index) => {
    result[vlan.name] = (index + 1) * 10;
  });
  return result;
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

/**
 * Assigns a vendor-neutral interface name (eth0/0, eth0/1, ...) per device
 * per link it participates in, sequential in link order — this is what
 * lets the diagram show port names instead of bare device-to-device lines.
 * Also builds each device's `interfaces[]`: P2P links (both ends
 * L3-capable, per `plan.p2pLinks`) get that side's assigned IP; everything
 * else (router<->switch trunks, switch<->switch interlinks) is marked as a
 * VLAN trunk carrying every VLAN in this design — there's no per-switch
 * VLAN membership modeling yet, so "all VLANs on every trunk" is the only
 * consistent answer today. A trunk's L3-capable end (a router, never an
 * access switch) additionally gets `svis`: its own address on every VLAN,
 * for config-gen to render as router-on-a-stick subinterfaces/HSRP.
 */
function assignInterfaces(
  links: LogicalLink[],
  p2pLinks: Record<string, P2pLinkAllocation>,
  vlanSvis: VlanSviInfo[],
  roleById: Map<string, DeviceRole>,
): { linkInterfaces: Map<string, { ifaceA: string; ifaceB: string }>; interfacesByDevice: Map<string, Interface[]> } {
  const allVlanIds = vlanSvis.map((v) => v.vlanId);

  const interfaceCounters = new Map<string, number>();
  const nextInterfaceName = (deviceId: string): string => {
    const n = interfaceCounters.get(deviceId) ?? 0;
    interfaceCounters.set(deviceId, n + 1);
    return `eth0/${n}`;
  };

  const linkInterfaces = new Map<string, { ifaceA: string; ifaceB: string }>();
  const interfacesByDevice = new Map<string, Interface[]>();
  const addInterface = (deviceId: string, iface: Interface) => {
    const list = interfacesByDevice.get(deviceId) ?? [];
    list.push(iface);
    interfacesByDevice.set(deviceId, list);
  };

  const addTrunkInterface = (deviceId: string, ifaceName: string, peerId: string, label: string) => {
    const role = mustGet(roleById, deviceId, "device role");
    const svis = L3_CAPABLE_ROLES.has(role)
      ? vlanSvis.map((vlan) => ({ vlanId: vlan.vlanId, ip: `${vlan.deviceIps[deviceId] ?? vlan.gateway}/${vlan.prefixLength}` }))
      : undefined;
    addInterface(deviceId, {
      name: ifaceName,
      trunk: true,
      allowedVlans: allVlanIds,
      ...(svis ? { svis } : {}),
      description: `${label} to ${peerId}`,
    });
  };

  for (const link of links) {
    const ifaceA = nextInterfaceName(link.a);
    const ifaceB = nextInterfaceName(link.b);
    linkInterfaces.set(link.id, { ifaceA, ifaceB });

    const p2p = p2pLinks[link.id];
    if (p2p) {
      addInterface(link.a, { name: ifaceA, ip: `${p2p.ipA}/31`, description: `${link.label} to ${link.b}` });
      addInterface(link.b, { name: ifaceB, ip: `${p2p.ipB}/31`, description: `${link.label} to ${link.a}` });
    } else {
      addTrunkInterface(link.a, ifaceA, link.b, link.label);
      addTrunkInterface(link.b, ifaceB, link.a, link.label);
    }
  }

  return { linkInterfaces, interfacesByDevice };
}
