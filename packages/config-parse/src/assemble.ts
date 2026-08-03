import type { Design, Device, Interface, Link, Segment, Svi } from "@netdesign/schema";
import { parseDesign } from "@netdesign/schema";
import { addressOf, networkOf } from "./ip.js";
import { buildFindings } from "./findings.js";
import { inferRole, toDeviceId } from "./roles.js";
import type { Finding, ParsedDevice } from "./types.js";

export interface AssembleOptions {
  /** Site name for the design's meta. Defaults to a neutral label — the config can't know it. */
  siteName?: string;
}

export interface ConfigToDesignResult {
  /** Schema-valid design describing EXACTLY what the uploaded configs contain. */
  design: Design;
  /** Advisory observations. Reporting only — never applied, never turned into config. */
  findings: Finding[];
  /** The parsed facts, for callers that want to show a per-device breakdown. */
  devices: ParsedDevice[];
}

/**
 * Assembles parsed device configs into a schema-valid {@link Design} that
 * documents the network AS UPLOADED.
 *
 * Guarantees that follow from the founder's scope for this feature:
 *  - Nothing is invented. Addresses, VLANs, HSRP groups and OSPF areas come
 *    straight from the files; a fact the configs don't contain is simply absent.
 *  - Nothing is corrected. Where the configs look wrong (equal HSRP priorities,
 *    a VLAN with no gateway) the design still reflects reality and the concern
 *    is reported as a {@link Finding}.
 *  - No configuration is generated. This module produces a design + findings;
 *    the uploaded text remains the source of truth on `ParsedDevice.sourceText`.
 *
 * Interpretations (role guesses, inferred links) are recorded in
 * `meta.assumptions` so the engineer can see and override them.
 */
export function assembleDesign(parsed: ParsedDevice[], options: AssembleOptions = {}): ConfigToDesignResult {
  if (parsed.length === 0) {
    throw new Error("No device configurations were provided.");
  }

  const assumptions: string[] = [];

  // --- device ids + roles ---
  const taken = new Set<string>();
  const idByHostname = new Map<string, string>();
  const devices: Device[] = parsed.map((device) => {
    const id = toDeviceId(device.hostname, taken);
    taken.add(id);
    idByHostname.set(device.hostname, id);

    const { role, reason } = inferRole(device);
    const article = /^[aeiou]/i.test(role) ? "an" : "a";
    assumptions.push(`${device.hostname} was classified as ${article} ${role} because it ${reason}.`);

    return {
      id,
      hostname: device.hostname,
      role,
      vendorHint: device.vendorHint,
      ...buildInterfaces(device),
    };
  });

  // --- segments: one per VLAN that has an L3 presence somewhere ---
  const { segments, sviGatewayNote } = buildSegments(parsed);
  if (sviGatewayNote) assumptions.push(sviGatewayNote);

  // --- links: inferred from shared routed subnets ---
  const { links, linkNote } = buildLinks(parsed, idByHostname);
  if (linkNote) assumptions.push(linkNote);

  const unparsedTotal = parsed.reduce((sum, device) => sum + device.unparsedLines.length, 0);
  if (unparsedTotal > 0) {
    assumptions.push(
      `${unparsedTotal} configuration line${unparsedTotal === 1 ? "" : "s"} across the uploads were not recognised by the parser and are not represented in this design (the original configuration is unchanged).`,
    );
  }

  const design = parseDesign({
    version: "1.0" as const,
    meta: {
      name: options.siteName ?? "Imported network",
      intentSummary: `Documentation generated from ${parsed.length} uploaded device configuration${parsed.length === 1 ? "" : "s"} (${parsed.map((d) => d.hostname).join(", ")}). This describes the network as configured; no configuration was generated or modified.`,
      assumptions,
      warnings: [],
    },
    devices,
    links,
    segments,
    ...buildRouting(parsed, idByHostname),
  });

  return { design, findings: buildFindings(parsed), devices: parsed };
}

function buildInterfaces(device: ParsedDevice): Pick<Device, "interfaces"> {
  // A parsed SVI (`interface Vlan10`) is not a physical port — it's carried on
  // the device's trunk as an `svis` entry, matching how the composers model the
  // L3 boundary, so the diagram and HLD read the same for imported designs.
  const svis: Svi[] = device.interfaces
    .filter((iface) => iface.sviVlanId !== undefined && iface.ip)
    .map((iface) => ({ vlanId: iface.sviVlanId!, ip: iface.ip! }));

  const physical = device.interfaces.filter((iface) => iface.sviVlanId === undefined);
  let sviAttached = false;

  const interfaces: Interface[] = physical.map((iface) => {
    // Subinterface VLAN gateways (router-on-a-stick) surface as svis on the parent.
    const subinterfaceSvis = device.interfaces
      .filter((other) => other.encapsulationVlanId !== undefined && other.name.startsWith(`${iface.name}.`) && other.ip)
      .map((other) => ({ vlanId: other.encapsulationVlanId!, ip: other.ip! }));

    const attachSvis = !sviAttached && iface.trunk && svis.length > 0;
    if (attachSvis) sviAttached = true;
    const attached = attachSvis ? svis : subinterfaceSvis.length > 0 ? subinterfaceSvis : undefined;

    return {
      name: iface.name,
      ...(iface.ip ? { ip: iface.ip } : {}),
      ...(iface.trunk ? { trunk: true } : {}),
      ...(iface.allowedVlans?.length ? { allowedVlans: iface.allowedVlans } : {}),
      ...(iface.accessVlan !== undefined ? { vlan: iface.accessVlan } : {}),
      ...(attached ? { svis: attached } : {}),
      ...(iface.description ? { description: iface.description } : {}),
    };
  });

  // An SVI-bearing device with no trunk (e.g. uplinks only) still needs its
  // SVIs represented; hang them on the first interface rather than losing them.
  if (svis.length > 0 && !sviAttached && interfaces.length > 0) {
    interfaces[0] = { ...interfaces[0]!, svis };
  }

  return interfaces.length > 0 ? { interfaces } : {};
}

function buildSegments(parsed: ParsedDevice[]): { segments: Segment[]; sviGatewayNote: string | null } {
  const byVlanId = new Map<number, { name?: string; cidrs: string[]; hsrpVirtualIps: string[] }>();

  for (const device of parsed) {
    for (const vlan of device.vlans) {
      const entry = byVlanId.get(vlan.id) ?? { cidrs: [], hsrpVirtualIps: [] };
      if (!entry.name && vlan.name) entry.name = vlan.name;
      byVlanId.set(vlan.id, entry);
    }
    for (const iface of device.interfaces) {
      const vlanId = iface.sviVlanId ?? iface.encapsulationVlanId;
      if (vlanId === undefined) continue;
      const entry = byVlanId.get(vlanId) ?? { cidrs: [], hsrpVirtualIps: [] };
      if (iface.ip) entry.cidrs.push(iface.ip);
      if (iface.hsrp?.virtualIp) entry.hsrpVirtualIps.push(iface.hsrp.virtualIp);
      byVlanId.set(vlanId, entry);
    }
  }

  let usedHsrpGateway = false;
  const segments: Segment[] = [];

  for (const [vlanId, entry] of [...byVlanId.entries()].sort((a, b) => a[0] - b[0])) {
    const network = entry.cidrs.map(networkOf).find((value): value is string => value !== null);
    // A VLAN with no L3 address anywhere is real (pure-L2 VLAN) but has no
    // subnet to document; the schema requires a cidr, so it can't be a segment.
    // findings.ts reports it instead of us inventing a range.
    if (!network) continue;

    // The gateway is the HSRP virtual IP when there is one — that IS what hosts
    // point at. Otherwise the single SVI address is the gateway.
    const gateway = entry.hsrpVirtualIps[0] ?? (entry.cidrs.length === 1 ? addressOf(entry.cidrs[0]!) : undefined);
    if (entry.hsrpVirtualIps[0]) usedHsrpGateway = true;

    segments.push({
      name: entry.name ?? `vlan-${vlanId}`,
      vlanId,
      cidr: network,
      ...(gateway ? { gateway } : {}),
    });
  }

  return {
    segments,
    sviGatewayNote: usedHsrpGateway
      ? "Where a VLAN has an HSRP standby address, that virtual IP is documented as the segment gateway (it is what hosts use)."
      : null,
  };
}

function buildLinks(parsed: ParsedDevice[], idByHostname: Map<string, string>): { links: Link[]; linkNote: string | null } {
  // Two routed interfaces on different devices sharing a subnet are connected.
  // This is exact for point-to-point links, which is how routed infrastructure
  // is built — and it is the ONLY link we can honestly derive from configs.
  const bySubnet = new Map<string, Array<{ deviceId: string; ifaceName: string }>>();

  for (const device of parsed) {
    const deviceId = idByHostname.get(device.hostname)!;
    for (const iface of device.interfaces) {
      if (!iface.ip || iface.sviVlanId !== undefined) continue;
      const network = networkOf(iface.ip);
      if (!network) continue;
      const list = bySubnet.get(network) ?? [];
      list.push({ deviceId, ifaceName: iface.name });
      bySubnet.set(network, list);
    }
  }

  const links: Link[] = [];
  for (const [subnet, endpoints] of bySubnet) {
    if (endpoints.length !== 2) continue; // ambiguous (or single-ended) — don't guess
    const [a, b] = endpoints as [(typeof endpoints)[number], (typeof endpoints)[number]];
    if (a.deviceId === b.deviceId) continue;
    links.push({
      a: `${a.deviceId}:${a.ifaceName}`,
      b: `${b.deviceId}:${b.ifaceName}`,
      kind: "ethernet",
      subnet,
      label: "Routed link",
    });
  }

  links.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const hasTrunks = parsed.some((device) => device.interfaces.some((iface) => iface.trunk));
  const note = hasTrunks
    ? "Links between devices were inferred from routed interfaces that share a subnet. Layer-2 trunk links cannot be derived from configuration alone (a config does not record what a port is plugged into), so trunk ports are shown on each device but not drawn as connections."
    : "Links between devices were inferred from routed interfaces that share a subnet.";

  return { links, linkNote: links.length > 0 || hasTrunks ? note : null };
}

function buildRouting(parsed: ParsedDevice[], idByHostname: Map<string, string>): Pick<Design, "routing"> {
  const ospfDevices = parsed.filter((device) => device.ospf);
  const anyHsrp = parsed.some((device) => device.interfaces.some((iface) => iface.hsrp));
  const defaultRoute = parsed.flatMap((d) => d.staticRoutes).find((route) => route.prefix === "0.0.0.0");

  if (ospfDevices.length === 0 && !anyHsrp && !defaultRoute) return {};

  // Group OSPF speakers by the areas their network statements actually name.
  const areaMembers = new Map<string, string[]>();
  for (const device of ospfDevices) {
    const deviceId = idByHostname.get(device.hostname)!;
    for (const area of new Set(device.ospf!.networks.map((network) => network.area))) {
      areaMembers.set(area, [...(areaMembers.get(area) ?? []), deviceId]);
    }
  }

  return {
    routing: {
      ...(ospfDevices.length > 0 ? { igp: "ospf" as const } : {}),
      ...(areaMembers.size > 0
        ? { ospfAreas: [...areaMembers.entries()].sort().map(([area, deviceIds]) => ({ area, deviceIds })) }
        : {}),
      ...(anyHsrp ? { firstHopRedundancy: "hsrp" as const } : {}),
      ...(defaultRoute ? { defaultRoute: "0.0.0.0/0" } : {}),
    },
  };
}
