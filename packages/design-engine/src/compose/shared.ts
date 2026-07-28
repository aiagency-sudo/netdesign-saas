import type { DesignParamsVlan, DeviceRole, Interface } from "@netdesign/schema";
import { L3_CAPABLE_ROLES, type P2pLinkAllocation } from "../ip-allocation/plan.js";
import { mustGet } from "../util.js";

/** A composed topology link before IP allocation decides whether it's a routed /31 or an L2 trunk. */
export interface LogicalLink {
  id: string;
  a: string;
  b: string;
  kind: "ethernet" | "port-channel";
  label: string;
}

/** A VLAN's addressing info needed to build each L3-capable device's per-VLAN SVI (svis). */
export interface VlanSviInfo {
  vlanId: number;
  prefixLength: number;
  gateway: string;
  /** deviceId -> that device's own address on this VLAN (only devices that needed one distinct from the gateway — see IpAllocationSegmentInput.l3DeviceIds). */
  deviceIps: Record<string, string>;
}

export function idsFor(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
}

export function assignVlanIds(vlans: DesignParamsVlan[]): Record<string, number> {
  const result: Record<string, number> = {};
  vlans.forEach((vlan, index) => {
    result[vlan.name] = (index + 1) * 10;
  });
  return result;
}

/**
 * Assigns a vendor-neutral interface name (eth0/0, eth0/1, ...) per device
 * per link it participates in, sequential in link order — this is what lets
 * the diagram show port names instead of bare device-to-device lines. Also
 * builds each device's `interfaces[]`: a link between two L3-capable devices
 * (per `plan.p2pLinks`) is a routed /31 and gets that side's assigned IP;
 * everything else is an L2 trunk carrying every VLAN. A trunk's L3-capable
 * end additionally gets `svis`: its own address on every VLAN, for config-gen
 * to render as SVIs/subinterfaces + HSRP.
 *
 * This is the single source of truth shared by every composer (branch-office
 * and campus): whether SVIs land on a router (branch) or a distribution switch
 * (campus) falls out of *which* L3-capable device happens to hold the L2 trunk
 * to the access layer — no per-pattern special-casing.
 */
export function assignInterfaces(
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

  // An SVI is a single logical VLAN interface per switch, so attach the svis
  // to only the FIRST trunk we assign a given L3 device — otherwise a
  // distribution switch with N access trunks would carry N duplicate copies of
  // every SVI (harmless in branch, where each L3 device had exactly one trunk).
  const sviAnchored = new Set<string>();
  const addTrunkInterface = (deviceId: string, ifaceName: string, peerId: string, label: string) => {
    const role = mustGet(roleById, deviceId, "device role");
    const wantsSvis = L3_CAPABLE_ROLES.has(role) && !sviAnchored.has(deviceId);
    if (wantsSvis) sviAnchored.add(deviceId);
    const svis = wantsSvis
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
