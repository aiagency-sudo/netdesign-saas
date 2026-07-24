import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import type { Design } from "@netdesign/schema";

/** Same sections as generateHldMarkdown(), built directly as Word document elements rather than converted from the markdown string. */
export async function generateHldDocx(design: Design): Promise<Buffer> {
  const children = [
    new Paragraph({ text: `${design.meta.name} — High-Level Design`, heading: HeadingLevel.TITLE }),
    ...overviewSection(design),
    ...assumptionsSection(design),
    ...warningsSection(design),
    ...topologySection(design),
    ...ipPlanSection(design),
    ...routingSection(design),
    ...securityZonesSection(design),
  ];

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({ text, heading: level });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 } });
}

function dataTable(headers: string[], rows: string[][]): Table {
  return new Table({
    rows: [headerRow(headers), ...rows.map((cells) => dataRow(cells))],
  });
}

function headerRow(headers: string[]): TableRow {
  return new TableRow({
    children: headers.map(
      (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] }),
    ),
  });
}

function dataRow(cells: string[]): TableRow {
  return new TableRow({ children: cells.map((text) => new TableCell({ children: [new Paragraph(text)] })) });
}

function overviewSection(design: Design): Paragraph[] {
  const paragraphs = [heading("Overview"), new Paragraph(design.meta.intentSummary)];
  if (design.meta.designPattern) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: `Pattern: ${design.meta.designPattern}`, bold: true })] }));
  }
  return paragraphs;
}

function assumptionsSection(design: Design): Paragraph[] {
  const assumptions = design.meta.assumptions ?? [];
  if (assumptions.length === 0) {
    return [heading("Assumptions"), new Paragraph("No assumptions were recorded for this design.")];
  }
  return [heading("Assumptions"), ...assumptions.map((assumption) => bullet(assumption))];
}

function warningsSection(design: Design): Paragraph[] {
  const warnings = design.meta.warnings ?? [];
  if (warnings.length === 0) {
    return [];
  }
  return [heading("Warnings"), ...warnings.map((warning) => bullet(warning))];
}

function topologySection(design: Design): (Paragraph | Table)[] {
  const deviceRows = design.devices.map((device) => [
    device.hostname ?? device.id,
    device.role,
    device.vendorHint,
    device.model ?? "—",
    device.zone ?? "—",
  ]);
  const linkRows = design.links.map((link) => [link.a, link.b, link.kind ?? "—", link.label ?? "—"]);

  return [
    heading("Topology"),
    heading("Devices", HeadingLevel.HEADING_2),
    dataTable(["Device", "Role", "Vendor", "Model", "Zone"], deviceRows),
    heading("Links", HeadingLevel.HEADING_2),
    dataTable(["A", "B", "Kind", "Label"], linkRows),
  ];
}

function ipPlanSection(design: Design): (Paragraph | Table)[] {
  const segmentRows = design.segments.map((segment) => [
    segment.name,
    segment.vlanId?.toString() ?? "—",
    segment.cidr,
    segment.gateway ?? "—",
    segment.purpose ?? "—",
    segment.dhcp === undefined ? "—" : segment.dhcp ? "Yes" : "No",
  ]);

  const deviceRows = design.devices.map((device) => [device.hostname ?? device.id, device.mgmtIp ?? "—", device.loopback ?? "—"]);

  const interfaceRows = design.devices.flatMap((device) =>
    (device.interfaces ?? []).map((iface) => [
      device.hostname ?? device.id,
      iface.name,
      iface.ip ?? (iface.trunk ? `Trunk (VLANs: ${(iface.allowedVlans ?? []).join(", ") || "none"})` : "—"),
      iface.description ?? "—",
    ]),
  );

  return [
    heading("IP Plan"),
    heading("Segments (VLAN table)", HeadingLevel.HEADING_2),
    dataTable(["Name", "VLAN ID", "CIDR", "Gateway", "Purpose", "DHCP"], segmentRows),
    heading("Device Addressing", HeadingLevel.HEADING_2),
    dataTable(["Device", "Mgmt IP", "Loopback"], deviceRows),
    heading("Interfaces", HeadingLevel.HEADING_2),
    dataTable(["Device", "Interface", "Address", "Description"], interfaceRows),
  ];
}

function routingSection(design: Design): Paragraph[] {
  if (!design.routing) {
    return [];
  }
  const { igp, firstHopRedundancy, defaultRoute, bgp, ospfAreas } = design.routing;
  const bullets: Paragraph[] = [];
  if (igp) bullets.push(bullet(`IGP: ${igp}`));
  if (firstHopRedundancy) bullets.push(bullet(`First-hop redundancy: ${firstHopRedundancy}`));
  if (defaultRoute) bullets.push(bullet(`Default route: ${defaultRoute}`));
  if (bgp?.asn !== undefined) bullets.push(bullet(`BGP ASN: ${bgp.asn}`));
  if (ospfAreas && ospfAreas.length > 0) {
    bullets.push(bullet(`OSPF areas: ${ospfAreas.map((area) => area.area ?? "(unnamed)").join(", ")}`));
  }
  return [heading("Routing"), ...bullets];
}

function securityZonesSection(design: Design): (Paragraph | Table)[] {
  const zonePolicies = design.security?.zonePolicies ?? [];
  const natRules = design.security?.natRules ?? [];

  if (zonePolicies.length === 0 && natRules.length === 0) {
    const zones = [...new Set(design.devices.map((device) => device.zone).filter((zone): zone is string => Boolean(zone)))];
    if (zones.length === 0) {
      return [heading("Security Zones"), new Paragraph("No zones or zone policies are defined for this design.")];
    }
    return [
      heading("Security Zones"),
      new Paragraph(`Zones present on this design: ${zones.join(", ")}.`),
      new Paragraph("No explicit zone policies or NAT rules have been defined yet."),
    ];
  }

  const elements: (Paragraph | Table)[] = [heading("Security Zones")];
  if (zonePolicies.length > 0) {
    elements.push(
      heading("Zone Policies", HeadingLevel.HEADING_2),
      dataTable(
        ["From", "To", "Action", "Services"],
        zonePolicies.map((policy) => [policy.from, policy.to, policy.action, (policy.services ?? []).join(", ") || "—"]),
      ),
    );
  }
  if (natRules.length > 0) {
    elements.push(
      heading("NAT Rules", HeadingLevel.HEADING_2),
      dataTable(
        ["Kind", "Inside", "Outside"],
        natRules.map((rule) => [rule.kind ?? "—", rule.inside ?? "—", rule.outside ?? "—"]),
      ),
    );
  }
  return elements;
}
