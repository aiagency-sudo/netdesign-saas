import type { Design } from "@netdesign/schema";
import { parseCidr } from "./cidr.js";
import type { IpAllocationPlan } from "./plan.js";

/** Every CIDR block an allocation plan handed out, labeled by where it came from. */
export function flattenPlanCidrs(plan: IpAllocationPlan): Array<{ label: string; cidr: string }> {
  const entries: Array<{ label: string; cidr: string }> = [{ label: "mgmt", cidr: plan.mgmt.cidr }];

  for (const [deviceId, cidr] of Object.entries(plan.loopbacks)) {
    entries.push({ label: `loopback:${deviceId}`, cidr });
  }
  for (const [linkId, allocation] of Object.entries(plan.p2pLinks)) {
    entries.push({ label: `p2p:${linkId}`, cidr: allocation.cidr });
  }
  for (const [name, allocation] of Object.entries(plan.segments)) {
    entries.push({ label: `segment:${name}`, cidr: allocation.cidr });
  }

  return entries;
}

/**
 * Every address a composed Design handed out, labeled by where it came
 * from — mgmt IPs are treated as implicit /32s so they're checked against
 * loopbacks/P2P/VLAN ranges too, since they all come from the same pool.
 */
export function flattenDesignCidrs(design: Design): Array<{ label: string; cidr: string }> {
  const entries: Array<{ label: string; cidr: string }> = [];

  for (const device of design.devices) {
    if (device.mgmtIp) entries.push({ label: `mgmtIp:${device.id}`, cidr: `${device.mgmtIp}/32` });
    if (device.loopback) entries.push({ label: `loopback:${device.id}`, cidr: device.loopback });
  }
  design.links.forEach((link, index) => {
    if (link.subnet) entries.push({ label: `link:${link.a}--${link.b}#${index}`, cidr: link.subnet });
  });
  for (const segment of design.segments) {
    entries.push({ label: `segment:${segment.name}`, cidr: segment.cidr });
  }

  return entries;
}

/** Convenience wrapper: {@link flattenDesignCidrs} piped through {@link findOverlappingPairs}. */
export function findOverlappingSubnetsInDesign(
  design: Design,
): Array<[{ label: string; cidr: string }, { label: string; cidr: string }]> {
  return findOverlappingPairs(flattenDesignCidrs(design));
}

/** Returns every pair of labeled CIDRs whose address ranges intersect. An empty array means the set is overlap-free. */
export function findOverlappingPairs(
  entries: Array<{ label: string; cidr: string }>,
): Array<[{ label: string; cidr: string }, { label: string; cidr: string }]> {
  const ranges = entries.map((entry) => {
    const { network, size } = parseCidr(entry.cidr);
    return { entry, start: network, end: network + size };
  });

  const overlaps: Array<[{ label: string; cidr: string }, { label: string; cidr: string }]> = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!;
      const b = ranges[j]!;
      if (a.start < b.end && b.start < a.end) {
        overlaps.push([a.entry, b.entry]);
      }
    }
  }
  return overlaps;
}
