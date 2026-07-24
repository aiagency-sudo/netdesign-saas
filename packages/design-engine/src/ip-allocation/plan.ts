import type { DeviceRole, LinkKind } from "@netdesign/schema";
import { SubnetAllocator } from "./allocator.js";
import { intToIp, parseCidr } from "./cidr.js";

/**
 * Device roles that terminate Layer 3 and therefore get a loopback and can
 * anchor a routed point-to-point link. Access switches, access points, and
 * pure L2 devices are deliberately excluded — they get an access/trunk port
 * into a VLAN segment instead, never their own routed subnet.
 */
export const L3_CAPABLE_ROLES: ReadonlySet<DeviceRole> = new Set<DeviceRole>([
  "router",
  "core-switch",
  "distribution-switch",
  "firewall",
  "load-balancer",
  "vpn-concentrator",
  "cloud-gateway",
  "reverse-proxy",
]);

/** Link kinds that represent a physical/logical routed hop eligible for a /31, as opposed to a WAN, tunnel, wireless, or virtual link. */
const P2P_ELIGIBLE_LINK_KINDS: ReadonlySet<LinkKind> = new Set<LinkKind>(["ethernet", "fiber", "port-channel"]);

export interface IpAllocationDeviceInput {
  id: string;
  role: DeviceRole;
}

export interface IpAllocationLinkInput {
  /** Caller-assigned identifier used to key the result (e.g. `${a}--${b}`). */
  id: string;
  a: string;
  b: string;
  kind?: LinkKind;
}

export interface IpAllocationSegmentInput {
  name: string;
  /** Defaults to /24. */
  prefixLength?: number;
  /**
   * Device ids that each need their own unique address on this segment, in
   * addition to the shared gateway — e.g. an HSRP-paired router's own
   * subinterface address, distinct from the pair's shared virtual IP. Leave
   * empty/omitted when only one device ever has L3 presence on this segment
   * (that device's own address is just the gateway itself; no separate
   * allocation is needed).
   */
  l3DeviceIds?: string[];
}

export interface IpAllocationInput {
  /** The site's overall address block, e.g. "10.20.0.0/16". */
  siteSupernet: string;
  /** Defaults to /24. */
  mgmtPrefixLength?: number;
  devices: IpAllocationDeviceInput[];
  links: IpAllocationLinkInput[];
  segments: IpAllocationSegmentInput[];
}

export interface MgmtAllocation {
  cidr: string;
  gateway: string;
  /** deviceId -> mgmt IP (a plain address, not a CIDR — matches design-schema's `mgmtIp`). */
  deviceIps: Record<string, string>;
}

export interface P2pLinkAllocation {
  /** The /31 (or wider, if configured) subnet. */
  cidr: string;
  ipA: string;
  ipB: string;
}

export interface SegmentAllocation {
  cidr: string;
  gateway: string;
  /** deviceId -> that device's own address on this segment (only for the segment's `l3DeviceIds`, if any). */
  deviceIps: Record<string, string>;
}

export interface IpAllocationPlan {
  mgmt: MgmtAllocation;
  /** deviceId -> loopback CIDR (/32), for L3-capable devices only. */
  loopbacks: Record<string, string>;
  /** linkId -> P2P allocation, for links between two L3-capable devices only. */
  p2pLinks: Record<string, P2pLinkAllocation>;
  /** segment name -> allocation. */
  segments: Record<string, SegmentAllocation>;
}

/**
 * Deterministic IP allocation for a single site, per CLAUDE.md's hard rule:
 * "IP addressing is computed deterministically by the engine (no LLM math).
 * No overlapping subnets, ever."
 *
 * Allocation order (see packages/design-engine/README.md for the full rule
 * writeup): management network, then loopbacks, then point-to-point links,
 * then VLAN/user segments — all carved from one shared, non-overlapping
 * SubnetAllocator over `siteSupernet`.
 */
export function planIpAllocation(input: IpAllocationInput): IpAllocationPlan {
  const mgmtPrefixLength = input.mgmtPrefixLength ?? 24;
  const allocator = new SubnetAllocator(input.siteSupernet);

  const mgmt = allocateMgmtNetwork(allocator, input.devices, mgmtPrefixLength);
  const loopbacks = allocateLoopbacks(allocator, input.devices);
  const p2pLinks = allocateP2pLinks(allocator, input.devices, input.links);
  const segments = allocateSegments(allocator, input.segments);

  return { mgmt, loopbacks, p2pLinks, segments };
}

function allocateMgmtNetwork(
  allocator: SubnetAllocator,
  devices: IpAllocationDeviceInput[],
  mgmtPrefixLength: number,
): MgmtAllocation {
  const cidr = allocator.allocate(mgmtPrefixLength, "mgmt");
  const { network, size } = parseCidr(cidr);

  const usableHosts = size - 2; // exclude network/gateway convention: gateway takes the first host
  if (devices.length > usableHosts) {
    throw new Error(
      `Management block ${cidr} has room for ${usableHosts} device(s) but ${devices.length} were given; widen mgmtPrefixLength.`,
    );
  }

  const gateway = intToIp(network + 1);
  const deviceIps: Record<string, string> = {};
  devices.forEach((device, index) => {
    deviceIps[device.id] = intToIp(network + 2 + index);
  });

  return { cidr, gateway, deviceIps };
}

function allocateLoopbacks(
  allocator: SubnetAllocator,
  devices: IpAllocationDeviceInput[],
): Record<string, string> {
  const loopbacks: Record<string, string> = {};
  for (const device of devices) {
    if (L3_CAPABLE_ROLES.has(device.role)) {
      loopbacks[device.id] = allocator.allocate(32, `loopback:${device.id}`);
    }
  }
  return loopbacks;
}

function allocateP2pLinks(
  allocator: SubnetAllocator,
  devices: IpAllocationDeviceInput[],
  links: IpAllocationLinkInput[],
): Record<string, P2pLinkAllocation> {
  const roleById = new Map(devices.map((d) => [d.id, d.role]));
  const p2pLinks: Record<string, P2pLinkAllocation> = {};

  for (const link of links) {
    if (!isPointToPointEligible(link, roleById)) continue;
    const cidr = allocator.allocate(31, `p2p:${link.id}`);
    const { network } = parseCidr(cidr);
    p2pLinks[link.id] = { cidr, ipA: intToIp(network), ipB: intToIp(network + 1) };
  }

  return p2pLinks;
}

function isPointToPointEligible(
  link: IpAllocationLinkInput,
  roleById: Map<string, DeviceRole>,
): boolean {
  const kind = link.kind ?? "ethernet";
  if (!P2P_ELIGIBLE_LINK_KINDS.has(kind)) return false;

  const roleA = roleById.get(link.a);
  const roleB = roleById.get(link.b);
  if (!roleA || !roleB) return false; // one end isn't a known device (e.g. "internet") — not ours to subnet

  return L3_CAPABLE_ROLES.has(roleA) && L3_CAPABLE_ROLES.has(roleB);
}

function allocateSegments(
  allocator: SubnetAllocator,
  segments: IpAllocationSegmentInput[],
): Record<string, SegmentAllocation> {
  const result: Record<string, SegmentAllocation> = {};
  for (const segment of segments) {
    const prefixLength = segment.prefixLength ?? 24;
    const cidr = allocator.allocate(prefixLength, `segment:${segment.name}`);
    const { network, size } = parseCidr(cidr);
    const l3DeviceIds = segment.l3DeviceIds ?? [];

    // Gateway takes the first host (network+1); each l3DeviceId takes the
    // next sequential host after that — network/gateway/device addresses
    // all count against the usable range.
    const usableHosts = size - 2;
    if (l3DeviceIds.length + 1 > usableHosts) {
      throw new Error(
        `Segment ${cidr} has room for ${usableHosts} host(s) but needs 1 (gateway) + ${l3DeviceIds.length} (device addresses); widen this segment's prefixLength.`,
      );
    }

    const deviceIps: Record<string, string> = {};
    l3DeviceIds.forEach((deviceId, index) => {
      deviceIps[deviceId] = intToIp(network + 2 + index);
    });

    result[segment.name] = { cidr, gateway: intToIp(network + 1), deviceIps };
  }
  return result;
}
