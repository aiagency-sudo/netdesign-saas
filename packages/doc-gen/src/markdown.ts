import type { Design } from "@netdesign/schema";

/**
 * design JSON -> structured markdown (BUILD_PLAN Session 9). Deterministic
 * and template-only, same discipline as config-gen: this never calls an
 * LLM, it only ever reads fields already present on a schema-valid Design.
 */
export function generateHldMarkdown(design: Design): string {
  const sections = [
    renderTitle(design),
    renderOverview(design),
    renderAssumptions(design),
    renderWarnings(design),
    renderTopology(design),
    renderIpPlan(design),
    renderRouting(design),
    renderSecurityZones(design),
  ].filter((section): section is string => section !== null);

  return `${sections.join("\n\n")}\n`;
}

function renderTitle(design: Design): string {
  return `# ${design.meta.name} — High-Level Design`;
}

function renderOverview(design: Design): string {
  const lines = ["## Overview", "", design.meta.intentSummary];
  if (design.meta.designPattern) {
    lines.push("", `**Pattern:** ${design.meta.designPattern}`);
  }
  return lines.join("\n");
}

function renderAssumptions(design: Design): string {
  const assumptions = design.meta.assumptions ?? [];
  if (assumptions.length === 0) {
    return "## Assumptions\n\nNo assumptions were recorded for this design.";
  }
  return ["## Assumptions", "", ...assumptions.map((assumption) => `- ${assumption}`)].join("\n");
}

function renderWarnings(design: Design): string | null {
  const warnings = design.meta.warnings ?? [];
  if (warnings.length === 0) {
    return null;
  }
  return ["## Warnings", "", ...warnings.map((warning) => `- ${warning}`)].join("\n");
}

function renderTopology(design: Design): string {
  const deviceRows = design.devices.map((device) =>
    row([device.hostname ?? device.id, device.role, device.vendorHint, device.model ?? "—", device.zone ?? "—"]),
  );
  const deviceTable = [
    table(["Device", "Role", "Vendor", "Model", "Zone"]),
    tableDivider(5),
    ...deviceRows,
  ].join("\n");

  const linkRows = design.links.map((link) => row([link.a, link.b, link.kind ?? "—", link.label ?? "—"]));
  const linkTable = [table(["A", "B", "Kind", "Label"]), tableDivider(4), ...linkRows].join("\n");

  return ["## Topology", "", "### Devices", "", deviceTable, "", "### Links", "", linkTable].join("\n");
}

function renderIpPlan(design: Design): string {
  const segmentRows = design.segments.map((segment) =>
    row([
      segment.name,
      segment.vlanId?.toString() ?? "—",
      segment.cidr,
      segment.gateway ?? "—",
      segment.purpose ?? "—",
      segment.dhcp === undefined ? "—" : segment.dhcp ? "Yes" : "No",
    ]),
  );
  const segmentTable = [
    table(["Name", "VLAN ID", "CIDR", "Gateway", "Purpose", "DHCP"]),
    tableDivider(6),
    ...segmentRows,
  ].join("\n");

  const deviceRows = design.devices.map((device) =>
    row([device.hostname ?? device.id, device.mgmtIp ?? "—", device.loopback ?? "—"]),
  );
  const deviceTable = [table(["Device", "Mgmt IP", "Loopback"]), tableDivider(3), ...deviceRows].join("\n");

  const interfaceRows = design.devices.flatMap((device) =>
    (device.interfaces ?? []).map((iface) =>
      row([
        device.hostname ?? device.id,
        iface.name,
        iface.ip ?? (iface.trunk ? `Trunk (VLANs: ${(iface.allowedVlans ?? []).join(", ") || "none"})` : "—"),
        iface.description ?? "—",
      ]),
    ),
  );
  const interfaceTable = [
    table(["Device", "Interface", "Address", "Description"]),
    tableDivider(4),
    ...interfaceRows,
  ].join("\n");

  return [
    "## IP Plan",
    "",
    "### Segments (VLAN table)",
    "",
    segmentTable,
    "",
    "### Device Addressing",
    "",
    deviceTable,
    "",
    "### Interfaces",
    "",
    interfaceTable,
  ].join("\n");
}

function renderRouting(design: Design): string | null {
  if (!design.routing) {
    return null;
  }
  const { igp, firstHopRedundancy, defaultRoute, bgp, ospfAreas } = design.routing;
  const lines = ["## Routing", ""];
  if (igp) lines.push(`- **IGP:** ${igp}`);
  if (firstHopRedundancy) lines.push(`- **First-hop redundancy:** ${firstHopRedundancy}`);
  if (defaultRoute) lines.push(`- **Default route:** ${defaultRoute}`);
  if (bgp?.asn !== undefined) lines.push(`- **BGP ASN:** ${bgp.asn}`);
  if (ospfAreas && ospfAreas.length > 0) {
    lines.push(`- **OSPF areas:** ${ospfAreas.map((area) => area.area ?? "(unnamed)").join(", ")}`);
  }
  return lines.join("\n");
}

function renderSecurityZones(design: Design): string {
  const zonePolicies = design.security?.zonePolicies ?? [];
  const natRules = design.security?.natRules ?? [];

  if (zonePolicies.length === 0 && natRules.length === 0) {
    const zones = [...new Set(design.devices.map((device) => device.zone).filter((zone): zone is string => Boolean(zone)))];
    if (zones.length === 0) {
      return "## Security Zones\n\nNo zones or zone policies are defined for this design.";
    }
    return [
      "## Security Zones",
      "",
      `Zones present on this design: ${zones.join(", ")}.`,
      "",
      "No explicit zone policies or NAT rules have been defined yet.",
    ].join("\n");
  }

  const sections = ["## Security Zones", ""];
  if (zonePolicies.length > 0) {
    const policyRows = zonePolicies.map((policy) =>
      row([policy.from, policy.to, policy.action, (policy.services ?? []).join(", ") || "—"]),
    );
    sections.push(
      "### Zone Policies",
      "",
      table(["From", "To", "Action", "Services"]),
      tableDivider(4),
      ...policyRows,
      "",
    );
  }
  if (natRules.length > 0) {
    const natRows = natRules.map((rule) => row([rule.kind ?? "—", rule.inside ?? "—", rule.outside ?? "—"]));
    sections.push("### NAT Rules", "", table(["Kind", "Inside", "Outside"]), tableDivider(3), ...natRows);
  }
  return sections.join("\n").trimEnd();
}

function table(headers: string[]): string {
  return row(headers);
}

function tableDivider(columns: number): string {
  return row(Array.from({ length: columns }, () => "---"));
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}
