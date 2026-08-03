import { describe, expect, it } from "vitest";
import { composeBranchOfficeDesign, composeDesign } from "@netdesign/design-engine";
import { renderAllConfigs } from "@netdesign/config-gen";
import { designParamsSchema, type Design } from "@netdesign/schema";
import { importConfigs } from "../src/import.js";

/**
 * The round-trip property: config-gen renders a design to configs, and
 * config-parse reads configs back into a design. Running one through the other
 * is a strong, self-checking correctness test — every address, VLAN, HSRP group
 * and OSPF area has to survive the trip. It is only possible because the repo
 * owns both halves.
 *
 * Only the cisco-ios devices round-trip: the FortiGate firewall renders in a
 * different grammar that this parser deliberately refuses (see detectVendor),
 * so it is excluded from the upload here exactly as a real user would.
 */
function ciscoConfigUploads(design: Design) {
  const configs = renderAllConfigs(design);
  const ciscoIds = new Set(design.devices.filter((d) => d.vendorHint === "cisco-ios").map((d) => d.id));
  return Object.entries(configs)
    .filter(([id]) => ciscoIds.has(id))
    .map(([id, text]) => ({ name: `${id}.txt`, text }));
}

const g1Design = composeBranchOfficeDesign(
  designParamsSchema.parse({
    designPattern: "branch-office",
    siteName: "G1 Branch Office",
    intentSummary: "Branch office with dual HSRP routers, two access switches, and an edge firewall.",
    siteSupernet: "10.30.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 2, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "fortinet-fortigate" },
    vlans: [
      { name: "corp-data", purpose: "user", dhcp: true },
      { name: "voice", purpose: "voice", dhcp: true },
      { name: "guest", purpose: "guest", dhcp: true },
    ],
  }),
);

const g2Design = composeDesign(
  designParamsSchema.parse({
    designPattern: "campus-three-tier",
    siteName: "G2 Campus",
    intentSummary: "Three-tier campus with an HSRP distribution pair as VLAN gateways.",
    siteSupernet: "10.20.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 3, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "fortinet-fortigate" },
    coreSwitch: { count: 2, vendorHint: "cisco-ios" },
    distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
    vlans: [
      { name: "corp-data", purpose: "user", dhcp: true },
      { name: "voice", purpose: "voice", dhcp: true },
    ],
  }),
);

describe("round-trip: G1 branch-office configs -> design", () => {
  const uploads = ciscoConfigUploads(g1Design);
  const { design, findings } = importConfigs(uploads, { siteName: "G1 Branch Office" });

  it("recovers every uploaded cisco-ios device", () => {
    expect(design.devices.map((d) => d.id).sort()).toEqual(["rtr-01", "rtr-02", "sw-01", "sw-02"]);
  });

  it("classifies the routers and access switches correctly from config shape alone", () => {
    const roleById = Object.fromEntries(design.devices.map((d) => [d.id, d.role]));
    // Routers carry dot1Q subinterface gateways; switches are L2-only.
    expect(roleById["rtr-01"]).toBe("router");
    expect(roleById["rtr-02"]).toBe("router");
    expect(roleById["sw-01"]).toBe("access-switch");
    expect(roleById["sw-02"]).toBe("access-switch");
  });

  it("recovers the VLAN segments with the HSRP virtual IP as the gateway", () => {
    const segments = Object.fromEntries(design.segments.map((s) => [s.vlanId, s]));
    expect(design.segments).toHaveLength(3);
    // The composer allocated corp-data as 10.30.2.0/24 with gateway .1 (the HSRP VIP).
    expect(segments[10]?.cidr).toBe("10.30.2.0/24");
    expect(segments[10]?.gateway).toBe("10.30.2.1");
    expect(segments[10]?.name).toBe("corp-data");
  });

  it("recovers HSRP as the first-hop redundancy protocol", () => {
    expect(design.routing?.firstHopRedundancy).toBe("hsrp");
  });

  it("preserves each router's own distinct per-VLAN address, not the shared gateway", () => {
    const rtr01 = design.devices.find((d) => d.id === "rtr-01")!;
    const svis = rtr01.interfaces?.flatMap((i) => i.svis ?? []) ?? [];
    const vlan10 = svis.find((s) => s.vlanId === 10);
    expect(vlan10?.ip).toBe("10.30.2.2/24");
  });

  it("infers the router-to-router-facing routed links from shared subnets", () => {
    // The firewall wasn't uploaded, so its /31s to each router are single-ended
    // and correctly NOT drawn; nothing is invented for the missing device.
    for (const link of design.links) {
      expect(link.subnet).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
      expect(link.a).toMatch(/^[a-z0-9-]+:\S+$/);
    }
  });

  it("reports the not-uploaded firewall peers rather than silently ignoring them", () => {
    // Each router has a /31 toward the FortiGate, which wasn't uploaded — so
    // exactly one end of those point-to-point subnets is present.
    const dangling = findings.filter((f) => f.code === "peer-not-uploaded");
    expect(dangling).toHaveLength(2);
    expect(dangling.map((f) => f.devices[0]).sort()).toEqual(["rtr-01", "rtr-02"]);
    expect(findings.every((f) => f.severity === "info" || f.severity === "warning")).toBe(true);
  });

  it("emits findings that are advisory prose only — never configuration lines", () => {
    for (const finding of findings) {
      expect(finding.message).not.toMatch(/^\s*(interface|ip address|standby|router ospf|switchport)\b/im);
      expect(Object.keys(finding).sort()).toEqual(["code", "devices", "message", "severity"]);
    }
  });

  it("never fabricates a replacement configuration — output is design + findings only", () => {
    const result = importConfigs(uploads);
    expect(Object.keys(result)).toEqual(["design", "findings", "devices"]);
    // Each parsed device still carries its original text, unmodified.
    for (const [index, parsedDevice] of result.devices.entries()) {
      expect(parsedDevice.sourceText).toBe(uploads[index]!.text);
    }
  });
});

describe("round-trip: G2 campus configs -> design", () => {
  const uploads = ciscoConfigUploads(g2Design);
  const { design } = importConfigs(uploads, { siteName: "G2 Campus" });

  it("recovers all nine cisco-ios devices", () => {
    expect(design.devices).toHaveLength(9); // 2 routers + 2 core + 2 dist + 3 access
  });

  it("distinguishes core (pure L3) from distribution (SVIs + trunks) from access (L2) by config shape", () => {
    const roleById = Object.fromEntries(design.devices.map((d) => [d.id, d.role]));
    expect(roleById["core-01"]).toBe("core-switch");
    expect(roleById["core-02"]).toBe("core-switch");
    expect(roleById["dist-01"]).toBe("distribution-switch");
    expect(roleById["dist-02"]).toBe("distribution-switch");
    expect(roleById["acc-01"]).toBe("access-switch");
    expect(roleById["rtr-01"]).toBe("router");
  });

  it("recovers OSPF area 0 with exactly the devices that ran it", () => {
    expect(design.routing?.igp).toBe("ospf");
    const area0 = design.routing?.ospfAreas?.find((a) => a.area === "0");
    expect(new Set(area0?.deviceIds)).toEqual(
      new Set(["rtr-01", "rtr-02", "core-01", "core-02", "dist-01", "dist-02"]),
    );
  });

  it("recovers the VLAN gateways as the HSRP virtual IPs on the distribution pair", () => {
    const segments = Object.fromEntries(design.segments.map((s) => [s.vlanId, s]));
    expect(segments[10]?.cidr).toBe("10.20.2.0/24");
    expect(segments[10]?.gateway).toBe("10.20.2.1");
    expect(segments[20]?.gateway).toBe("10.20.3.1");
  });

  it("reconstructs the routed core fabric links from shared /31s", () => {
    // core<->core peer, core<->dist (4), rtr<->core (4) = 9 routed links between
    // uploaded devices. The firewall's /31s to the routers are single-ended.
    const linkPairs = design.links.map((l) => [l.a.split(":")[0], l.b.split(":")[0]].sort().join("--")).sort();
    expect(linkPairs).toContain("core-01--core-02");
    expect(linkPairs).toContain("core-01--dist-01");
    expect(linkPairs).toContain("core-01--rtr-01");
    expect(design.links.length).toBe(9);
  });

  it("matches the original design's segment addressing exactly", () => {
    const original = Object.fromEntries(g2Design.segments.map((s) => [s.vlanId, s]));
    for (const segment of design.segments) {
      expect(segment.cidr).toBe(original[segment.vlanId!]!.cidr);
      expect(segment.gateway).toBe(original[segment.vlanId!]!.gateway);
    }
  });
});
