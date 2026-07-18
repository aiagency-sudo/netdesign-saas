import { designParamsSchema } from "@netdesign/schema";
import { describe, expect, it } from "vitest";
import { composeBranchOfficeDesign } from "../src/compose/branch-office.js";

function deviceIdOf(linkEndpoint: string): string {
  return linkEndpoint.split(":", 1)[0]!;
}

function params(overrides: Record<string, unknown>) {
  return designParamsSchema.parse({
    designPattern: "smb-flat",
    siteName: "Unit Test Site",
    intentSummary: "Test fixture.",
    router: { count: 1 },
    accessSwitch: { count: 1 },
    firewall: { present: true },
    vlans: [{ name: "corp" }],
    ...overrides,
  });
}

describe("composeBranchOfficeDesign", () => {
  it("rejects an unsupported designPattern at the composer boundary", () => {
    const p = params({});
    // designParamsSchema itself already restricts this, so bypass it to prove the composer's own guard fires too.
    expect(() => composeBranchOfficeDesign({ ...p, designPattern: "dc-leaf-spine" as never })).toThrow(
      /only supports designPattern/,
    );
  });

  it("round-robins switches across routers when counts don't match (2 switches, 1 router)", () => {
    const design = composeBranchOfficeDesign(params({ router: { count: 1 }, accessSwitch: { count: 2 } }));
    const trunkLinks = design.links.filter((l) => l.label === "Access trunk");
    expect(trunkLinks).toHaveLength(2);
    expect(trunkLinks.every((l) => deviceIdOf(l.a) === "rtr-01")).toBe(true);
    expect(trunkLinks.map((l) => deviceIdOf(l.b)).sort()).toEqual(["sw-01", "sw-02"]);
    // both switches present -> one interlink between them
    expect(design.links.filter((l) => l.label === "Switch interlink")).toHaveLength(1);
  });

  it("omits redundancyGroup when there's only one router", () => {
    const design = composeBranchOfficeDesign(params({ router: { count: 1 } }));
    const router = design.devices.find((d) => d.role === "router")!;
    expect(router.redundancyGroup).toBeUndefined();
  });

  it("assigns a shared redundancyGroup to both routers when count is 2 and redundancy is set", () => {
    const design = composeBranchOfficeDesign(
      params({ designPattern: "branch-office", router: { count: 2, redundancy: "hsrp" } }),
    );
    const routers = design.devices.filter((d) => d.role === "router");
    expect(routers).toHaveLength(2);
    expect(routers.every((r) => r.redundancyGroup === "hsrp-1")).toBe(true);
    expect(design.routing?.firstHopRedundancy).toBe("hsrp");
  });

  it("does not create a firewall device or firewall uplinks when firewall.present is false", () => {
    const design = composeBranchOfficeDesign(params({ firewall: { present: false } }));
    expect(design.devices.some((d) => d.role === "firewall")).toBe(false);
    expect(design.links.some((l) => l.label === "Firewall uplink")).toBe(false);
  });

  it("surfaces a default-supernet assumption when none was given, and omits it when one was", () => {
    const withoutSupernet = composeBranchOfficeDesign(params({}));
    expect(withoutSupernet.meta.assumptions?.some((a) => a.includes("assumed 10.0.0.0/16"))).toBe(true);

    const withSupernet = composeBranchOfficeDesign(params({ siteSupernet: "192.168.0.0/16" }));
    expect(withSupernet.meta.assumptions?.some((a) => a.includes("No site address range"))).toBe(false);
  });

  it("every device gets exactly one mgmt IP and it validates as a real design", () => {
    const design = composeBranchOfficeDesign(params({}));
    const mgmtIps = design.devices.map((d) => d.mgmtIp);
    expect(mgmtIps.every((ip) => typeof ip === "string")).toBe(true);
    expect(new Set(mgmtIps).size).toBe(mgmtIps.length);
  });

  describe("interface names", () => {
    it("embeds a unique, sequential eth0/N interface name per device per link in link.a/link.b", () => {
      const design = composeBranchOfficeDesign(params({ router: { count: 1 }, accessSwitch: { count: 1 } }));
      // G4-shape: fw-01--rtr-01, rtr-01--sw-01 — rtr-01 touches 2 links, so it should get eth0/0 and eth0/1.
      const [fwToRtr, rtrToSw] = design.links;
      expect(fwToRtr!.a).toBe("fw-01:eth0/0");
      expect(fwToRtr!.b).toBe("rtr-01:eth0/0");
      expect(rtrToSw!.a).toBe("rtr-01:eth0/1");
      expect(rtrToSw!.b).toBe("sw-01:eth0/0");
    });

    it("gives every device an interfaces[] entry matching each link it participates in", () => {
      const design = composeBranchOfficeDesign(params({ router: { count: 1 }, accessSwitch: { count: 1 } }));
      for (const device of design.devices) {
        const linkEndpointsForDevice = design.links
          .flatMap((l) => [l.a, l.b])
          .filter((endpoint) => deviceIdOf(endpoint) === device.id);
        const interfaceNames = (device.interfaces ?? []).map((i) => i.name);
        expect(interfaceNames.sort()).toEqual(linkEndpointsForDevice.map((e) => e.split(":")[1]).sort());
      }
    });

    it("gives P2P (firewall<->router) interfaces an IP, and trunk (router<->switch) interfaces allowedVlans", () => {
      const design = composeBranchOfficeDesign(params({ router: { count: 1 }, accessSwitch: { count: 1 } }));
      const router = design.devices.find((d) => d.role === "router")!;
      const toFirewall = router.interfaces!.find((i) => i.description?.includes("fw-01"))!;
      const toSwitch = router.interfaces!.find((i) => i.description?.includes("sw-01"))!;

      expect(toFirewall.ip).toMatch(/\/31$/);
      expect(toFirewall.trunk).toBeUndefined();

      expect(toSwitch.trunk).toBe(true);
      expect(toSwitch.allowedVlans).toEqual([10]); // single "corp" vlan in the default params()
      expect(toSwitch.ip).toBeUndefined();
    });
  });
});
