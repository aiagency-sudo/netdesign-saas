import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitDeviceConfigs } from "../src/cisco-ios.js";
import { importConfigs } from "../src/import.js";

/**
 * A real upload from a tester: four devices concatenated into ONE file, using
 * the `! Device: <id>` banners our own "Download configs" export emits.
 *
 * Before splitDeviceConfigs, this produced a single phantom device — each
 * `hostname` overwrote the previous one and every interface piled onto the last
 * device standing. Regression-locked here because download-then-reupload is the
 * most natural thing a user can try.
 */
const SITE_CONFIG = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "multi-device-site.txt"),
  "utf8",
);

describe("splitDeviceConfigs", () => {
  it("splits a concatenated site file into one section per device", () => {
    const sections = splitDeviceConfigs(SITE_CONFIG);
    expect(sections).toHaveLength(4);
    expect(sections.map((section) => /^\s*hostname\s+(\S+)/m.exec(section)?.[1])).toEqual([
      "rtr-01",
      "rtr-02",
      "sw-01",
      "sw-02",
    ]);
  });

  it("keeps each device's own interfaces with it, not merged into one", () => {
    const [rtr01, , sw01] = splitDeviceConfigs(SITE_CONFIG);
    expect(rtr01).toContain("ip address 10.0.1.5 255.255.255.254");
    expect(rtr01).not.toContain("10.0.1.7"); // rtr-02's address
    expect(sw01).toContain("Switch interlink to sw-02");
    expect(sw01).not.toContain("ip address"); // switches are L2-only here
  });

  it("leaves a single-device file untouched", () => {
    const single = "hostname only-one\n!\ninterface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n";
    expect(splitDeviceConfigs(single)).toEqual([single]);
  });

  it("leaves a file with no hostname untouched", () => {
    const nameless = "interface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n";
    expect(splitDeviceConfigs(nameless)).toEqual([nameless]);
  });
});

describe("importing a concatenated multi-device site file", () => {
  const { design, findings } = importConfigs(
    [{ name: "enterprise-site-configs.txt", text: SITE_CONFIG }],
    { siteName: "Putakon Enterprise" },
  );

  it("produces all four devices, not one merged device", () => {
    expect(design.devices.map((device) => device.id)).toEqual(["rtr-01", "rtr-02", "sw-01", "sw-02"]);
  });

  it("classifies routers and switches independently", () => {
    const roleById = Object.fromEntries(design.devices.map((device) => [device.id, device.role]));
    expect(roleById["rtr-01"]).toBe("router");
    expect(roleById["rtr-02"]).toBe("router");
    expect(roleById["sw-01"]).toBe("access-switch");
    expect(roleById["sw-02"]).toBe("access-switch");
  });

  it("keeps each router's own address rather than piling them onto one device", () => {
    const rtr01 = design.devices.find((device) => device.id === "rtr-01")!;
    const rtr02 = design.devices.find((device) => device.id === "rtr-02")!;
    expect(rtr01.interfaces?.[0]?.ip).toBe("10.0.1.5/31");
    expect(rtr02.interfaces?.[0]?.ip).toBe("10.0.1.7/31");
    expect(rtr01.interfaces).toHaveLength(1);
  });

  it("attributes VLAN findings to the switches that actually define them", () => {
    const vlanFindings = findings.filter((finding) => finding.code === "vlan-without-gateway");
    // VLANs 10/20/30 are defined on BOTH switches and have no SVI anywhere.
    expect(vlanFindings).toHaveLength(3);
    expect(new Set(vlanFindings.flatMap((finding) => finding.devices))).toEqual(new Set(["sw-01", "sw-02"]));
  });

  it("still reports each router's firewall-facing /31 as a peer that wasn't uploaded", () => {
    const dangling = findings.filter((finding) => finding.code === "peer-not-uploaded");
    expect(dangling.map((finding) => finding.devices[0]).sort()).toEqual(["rtr-01", "rtr-02"]);
  });

  it("records that L2 trunk links can't be derived, so the switch interlink isn't invented", () => {
    // The switches only have trunks, so no link between them can be proven.
    expect(design.links).toHaveLength(0);
    expect(design.meta.assumptions?.some((a) => a.includes("Layer-2 trunk links cannot be derived"))).toBe(true);
  });
});
