import { describe, expect, it } from "vitest";
import { designParamsSchema } from "@netdesign/schema";
import { composeDesign } from "../../src/compose/index.js";
import { g2CampusParams } from "./fixtures/g2-campus-params.js";

/**
 * G2 campus with the wireless controller present. The controller is a service
 * -block device: trunked to both distribution switches, managed from the
 * management network, and NOT a routing peer — so it must not pick up a
 * loopback, a /31, an SVI or an OSPF adjacency.
 */
const design = composeDesign(
  designParamsSchema.parse({
    ...g2CampusParams,
    siteName: "G2 Campus (wireless)",
    wirelessController: { present: true, vendorHint: "cisco-ios" },
  }),
);

const wlc = design.devices.find((device) => device.id === "wlc-01");
const distIds = design.devices.filter((d) => d.role === "distribution-switch").map((d) => d.id);

describe("campus composer — wireless controller", () => {
  it("places one wireless controller with a management address", () => {
    expect(wlc).toBeDefined();
    expect(wlc!.role).toBe("wireless-controller");
    expect(wlc!.mgmtIp).toMatch(/^10\.20\./);
  });

  it("trunks it to every distribution switch", () => {
    const wlcLinks = design.links.filter((link) => link.a.startsWith("wlc-01:") || link.b.startsWith("wlc-01:"));
    expect(wlcLinks).toHaveLength(distIds.length);

    for (const link of wlcLinks) {
      const peer = link.a.startsWith("wlc-01:") ? link.b : link.a;
      expect(distIds).toContain(peer.split(":")[0]);
      // A trunk, not a routed hop: no /31 was allocated to it.
      expect(link.subnet).toBeUndefined();
      expect(link.label).toBe("Wireless controller trunk");
    }
  });

  it("gives the controller trunk ports carrying the VLANs, but no SVIs and no routed address", () => {
    const vlanIds = design.segments.map((segment) => segment.vlanId);
    for (const iface of wlc!.interfaces ?? []) {
      expect(iface.trunk).toBe(true);
      expect(iface.allowedVlans).toEqual(vlanIds);
      expect(iface.ip).toBeUndefined();
      expect(iface.svis).toBeUndefined();
    }
  });

  it("is not an L3 device: no loopback, and not an OSPF speaker", () => {
    expect(wlc!.loopback).toBeUndefined();
    const area0 = design.routing?.ospfAreas?.find((area) => area.area === "0");
    expect(area0!.deviceIds).not.toContain("wlc-01");
  });

  it("leaves the distribution SVIs anchored to the access trunk, not the controller trunk", () => {
    for (const distId of distIds) {
      const dist = design.devices.find((device) => device.id === distId)!;
      const withSvis = (dist.interfaces ?? []).filter((iface) => iface.svis && iface.svis.length > 0);
      // Exactly one interface carries the SVIs...
      expect(withSvis).toHaveLength(1);
      // ...and it's an access trunk, not the wireless-controller trunk.
      expect(withSvis[0]!.description).toMatch(/^Access trunk to acc-/);
    }
  });

  it("records the placement as an assumption the engineer can challenge", () => {
    expect(design.meta.assumptions.join(" ")).toContain("wireless controller (wlc-01) is trunked to both distribution");
  });
});

describe("campus composer — wireless controller absent", () => {
  it("composes no controller when the params don't ask for one", () => {
    const withoutWlc = composeDesign(designParamsSchema.parse(g2CampusParams));
    expect(withoutWlc.devices.find((device) => device.role === "wireless-controller")).toBeUndefined();
    expect(withoutWlc.meta.assumptions.join(" ")).not.toContain("wireless controller");
  });
});
