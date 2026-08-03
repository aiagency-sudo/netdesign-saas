import { networkOf } from "./ip.js";
import type { Finding, ParsedDevice } from "./types.js";

/**
 * Builds advisory observations about the uploaded configuration.
 *
 * SCOPE RULE (founder, 2026-07): findings are REPORTING ONLY. They describe
 * what was observed and, at most, what the engineer may want to look at. They
 * MUST NOT contain generated configuration lines, and nothing here modifies the
 * parsed facts or the uploaded text — the client's configuration is the source
 * of truth and stands exactly as written. If you are tempted to add a "fixed
 * config" field to a Finding, that belongs in a different feature.
 */
export function buildFindings(parsed: ParsedDevice[]): Finding[] {
  const findings: Finding[] = [];

  findings.push(...hsrpFindings(parsed));
  findings.push(...vlanFindings(parsed));
  findings.push(...interfaceFindings(parsed));
  findings.push(...routingFindings(parsed));
  findings.push(...parseCoverageFindings(parsed));

  return findings;
}

/** HSRP groups whose members share a priority (no deterministic active router) or lack preempt. */
function hsrpFindings(parsed: ParsedDevice[]): Finding[] {
  const findings: Finding[] = [];
  // Explicit `| undefined` rather than `?:` — the repo runs exactOptionalPropertyTypes.
  interface HsrpMember {
    hostname: string;
    priority: number | undefined;
    preempt: boolean;
    virtualIp: string | undefined;
  }
  const byGroup = new Map<string, HsrpMember[]>();

  for (const device of parsed) {
    for (const iface of device.interfaces) {
      if (!iface.hsrp) continue;
      // Key by group + virtual IP so distinct VLANs reusing a group number don't merge.
      const key = `${iface.hsrp.group}|${iface.hsrp.virtualIp ?? "?"}`;
      byGroup.set(key, [
        ...(byGroup.get(key) ?? []),
        { hostname: device.hostname, priority: iface.hsrp.priority, preempt: iface.hsrp.preempt, virtualIp: iface.hsrp.virtualIp },
      ]);
    }
  }

  for (const [key, members] of byGroup) {
    const group = key.split("|")[0]!;
    const hostnames = members.map((m) => m.hostname);

    if (members.length > 1) {
      const priorities = members.map((m) => m.priority ?? 100);
      if (new Set(priorities).size === 1) {
        findings.push({
          severity: "warning",
          code: "hsrp-equal-priority",
          message: `HSRP group ${group} has the same priority (${priorities[0]}) on ${hostnames.join(" and ")}, so which device becomes active is not deterministic — it depends on boot order and interface addresses.`,
          devices: hostnames,
        });
      }

      const withoutPreempt = members.filter((m) => !m.preempt).map((m) => m.hostname);
      if (withoutPreempt.length > 0 && withoutPreempt.length < members.length) {
        findings.push({
          severity: "info",
          code: "hsrp-preempt-inconsistent",
          message: `HSRP group ${group} has preempt configured on some members but not on ${withoutPreempt.join(", ")}, so the intended active device may not reclaim the role after a failover.`,
          devices: withoutPreempt,
        });
      }
    }

    if (members.length === 1) {
      findings.push({
        severity: "info",
        code: "hsrp-single-member",
        message: `HSRP group ${group} appears on only ${hostnames[0]} in the uploaded configurations — its peer may not have been included in the upload.`,
        devices: hostnames,
      });
    }
  }

  return findings;
}

/** VLANs defined or trunked but with no layer-3 gateway anywhere in the upload. */
function vlanFindings(parsed: ParsedDevice[]): Finding[] {
  const findings: Finding[] = [];

  const gatewayVlans = new Set<number>();
  const definedVlans = new Map<number, string[]>();
  const trunkedVlans = new Map<number, string[]>();

  for (const device of parsed) {
    for (const iface of device.interfaces) {
      const l3Vlan = iface.sviVlanId ?? iface.encapsulationVlanId;
      if (l3Vlan !== undefined && iface.ip) gatewayVlans.add(l3Vlan);
      for (const vlanId of iface.allowedVlans ?? []) {
        trunkedVlans.set(vlanId, [...(trunkedVlans.get(vlanId) ?? []), device.hostname]);
      }
    }
    for (const vlan of device.vlans) {
      definedVlans.set(vlan.id, [...(definedVlans.get(vlan.id) ?? []), device.hostname]);
    }
  }

  for (const [vlanId, hostnames] of [...definedVlans].sort((a, b) => a[0] - b[0])) {
    if (gatewayVlans.has(vlanId)) continue;
    findings.push({
      severity: "warning",
      code: "vlan-without-gateway",
      message: `VLAN ${vlanId} is defined on ${unique(hostnames).join(", ")} but no layer-3 gateway (SVI or subinterface) for it appears in the uploaded configurations — hosts on it would have no default gateway unless one is configured on a device that was not uploaded.`,
      devices: unique(hostnames),
    });
  }

  for (const [vlanId, hostnames] of [...trunkedVlans].sort((a, b) => a[0] - b[0])) {
    if (definedVlans.has(vlanId)) continue;
    findings.push({
      severity: "info",
      code: "vlan-trunked-not-defined",
      message: `VLAN ${vlanId} is allowed on a trunk on ${unique(hostnames).join(", ")} but is not defined in that device's VLAN database.`,
      devices: unique(hostnames),
    });
  }

  return findings;
}

/** Shutdown interfaces that carry configuration, and duplicate addresses. */
function interfaceFindings(parsed: ParsedDevice[]): Finding[] {
  const findings: Finding[] = [];
  const addressOwners = new Map<string, string[]>();

  for (const device of parsed) {
    for (const iface of device.interfaces) {
      if (iface.shutdown && (iface.ip || iface.trunk)) {
        findings.push({
          severity: "info",
          code: "interface-shutdown",
          message: `${device.hostname} ${iface.name} is administratively shut down but still carries configuration; it is documented but is not currently forwarding.`,
          devices: [device.hostname],
        });
      }
      if (iface.ip) {
        addressOwners.set(iface.ip, [...(addressOwners.get(iface.ip) ?? []), `${device.hostname} ${iface.name}`]);
      }
    }
  }

  for (const [ip, owners] of addressOwners) {
    if (owners.length > 1) {
      findings.push({
        severity: "warning",
        code: "duplicate-address",
        message: `The address ${ip} is configured in more than one place: ${owners.join(", ")}.`,
        devices: unique(owners.map((owner) => owner.split(" ")[0]!)),
      });
    }
  }

  return findings;
}

/** Routed subnets that only one device claims, and L3 devices with no routing at all. */
function routingFindings(parsed: ParsedDevice[]): Finding[] {
  const findings: Finding[] = [];

  const subnetOwners = new Map<string, string[]>();
  for (const device of parsed) {
    for (const iface of device.interfaces) {
      if (!iface.ip || iface.sviVlanId !== undefined) continue;
      const network = networkOf(iface.ip);
      if (!network) continue;
      subnetOwners.set(network, [...(subnetOwners.get(network) ?? []), device.hostname]);
    }
  }

  for (const [subnet, owners] of subnetOwners) {
    // A /30 or /31 is unambiguously point-to-point, so exactly one end present
    // means the peer device wasn't uploaded — worth saying plainly, since the
    // resulting diagram will show that link going nowhere. Larger prefixes are
    // left alone: a single-owner /24 is just a host LAN, not a missing device.
    const prefixLength = Number(subnet.split("/")[1]);
    if (owners.length === 1 && (prefixLength === 30 || prefixLength === 31)) {
      findings.push({
        severity: "info",
        code: "peer-not-uploaded",
        message: `${owners[0]} has a point-to-point subnet ${subnet}, but the device on the other end was not part of this upload, so that connection is not drawn. Upload the peer's configuration to complete the topology.`,
        devices: unique(owners),
      });
    }

    if (owners.length > 2) {
      findings.push({
        severity: "info",
        code: "subnet-many-devices",
        message: `Subnet ${subnet} has interfaces on ${owners.length} devices (${unique(owners).join(", ")}), so the connection between them could not be drawn unambiguously as a point-to-point link.`,
        devices: unique(owners),
      });
    }
  }

  const ospfSpeakers = parsed.filter((device) => device.ospf);
  if (ospfSpeakers.length === 1) {
    findings.push({
      severity: "info",
      code: "ospf-single-speaker",
      message: `Only ${ospfSpeakers[0]!.hostname} runs OSPF in the uploaded configurations — its neighbours may not have been included in the upload.`,
      devices: [ospfSpeakers[0]!.hostname],
    });
  }

  return findings;
}

/** Tells the user plainly what the parser could not read, rather than silently dropping it. */
function parseCoverageFindings(parsed: ParsedDevice[]): Finding[] {
  return parsed
    .filter((device) => device.unparsedLines.length > 0)
    .map((device) => ({
      severity: "info" as const,
      code: "unparsed-lines",
      message: `${device.unparsedLines.length} line${device.unparsedLines.length === 1 ? "" : "s"} in ${device.sourceName} were not recognised by the parser and are not reflected in this documentation (for example: ${device.unparsedLines.slice(0, 3).join(" / ")}). The uploaded configuration itself is unchanged.`,
      devices: [device.hostname],
    }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
