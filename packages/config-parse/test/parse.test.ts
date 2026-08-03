import { describe, expect, it } from "vitest";
import { parseCiscoIosConfig, parseVlanList } from "../src/cisco-ios.js";
import { detectVendor, importConfigs, UnsupportedConfigError } from "../src/import.js";
import { netmaskToPrefixLength, networkOf, toCidr } from "../src/ip.js";

/** Hand-written, messily-formatted config — real uploads are not machine-generated. */
const MESSY_SWITCH = `
!
! Some operator comment
hostname DIST-SW-01
!
ip routing
!
vlan 10
 name corp-data
vlan 20
   name voice
vlan 99
 name mgmt-only
!
interface Vlan10
 ip address 10.1.10.2 255.255.255.0
 standby 10 ip 10.1.10.1
 standby 10 priority 110
 standby 10 preempt
 no shutdown
!
interface Vlan20
 ip address 10.1.20.2 255.255.255.0
 standby 20 ip 10.1.20.1
 standby 20 priority 110
!
interface GigabitEthernet0/1
 description Uplink to CORE-01
 no switchport
 ip address 10.1.0.1 255.255.255.252
!
interface GigabitEthernet0/2
 description Access trunk
 switchport mode trunk
 switchport trunk allowed vlan 10,20
 shutdown
!
interface GigabitEthernet0/3
 switchport mode access
 switchport access vlan 10
!
router ospf 1
 passive-interface Vlan10
 network 10.1.0.0 0.0.0.3 area 0
 network 10.1.10.0 0.0.0.255 area 0
!
ip route 0.0.0.0 0.0.0.0 10.1.0.2
!
some-unknown-command foo bar
!
end
`;

describe("parseCiscoIosConfig", () => {
  const device = parseCiscoIosConfig(MESSY_SWITCH, "dist-sw-01.txt");

  it("reads the hostname and ip routing", () => {
    expect(device.hostname).toBe("DIST-SW-01");
    expect(device.ipRoutingEnabled).toBe(true);
  });

  it("reads the VLAN database including a VLAN with no L3 interface", () => {
    expect(device.vlans).toEqual([
      { id: 10, name: "corp-data" },
      { id: 20, name: "voice" },
      { id: 99, name: "mgmt-only" },
    ]);
  });

  it("reads SVIs with their address and HSRP settings", () => {
    const vlan10 = device.interfaces.find((i) => i.sviVlanId === 10)!;
    expect(vlan10.ip).toBe("10.1.10.2/24");
    expect(vlan10.hsrp).toEqual({ group: 10, virtualIp: "10.1.10.1", priority: 110, preempt: true });

    // VLAN 20 has no `preempt` line — that must not be inherited from VLAN 10.
    const vlan20 = device.interfaces.find((i) => i.sviVlanId === 20)!;
    expect(vlan20.hsrp?.preempt).toBe(false);
  });

  it("reads routed ports, trunks, access ports and shutdown state", () => {
    const uplink = device.interfaces.find((i) => i.name === "GigabitEthernet0/1")!;
    expect(uplink.ip).toBe("10.1.0.1/30");
    expect(uplink.description).toBe("Uplink to CORE-01");
    expect(uplink.trunk).toBe(false);

    const trunk = device.interfaces.find((i) => i.name === "GigabitEthernet0/2")!;
    expect(trunk.trunk).toBe(true);
    expect(trunk.allowedVlans).toEqual([10, 20]);
    expect(trunk.shutdown).toBe(true);

    const access = device.interfaces.find((i) => i.name === "GigabitEthernet0/3")!;
    expect(access.accessVlan).toBe(10);
  });

  it("reads OSPF networks, passive interfaces and static routes", () => {
    expect(device.ospf?.processId).toBe(1);
    expect(device.ospf?.networks).toContainEqual({ network: "10.1.0.0", wildcard: "0.0.0.3", area: "0" });
    expect(device.ospf?.passiveInterfaces).toEqual(["Vlan10"]);
    expect(device.staticRoutes).toEqual([{ prefix: "0.0.0.0", netmask: "0.0.0.0", nextHop: "10.1.0.2" }]);
  });

  it("surfaces unrecognised lines instead of silently dropping them", () => {
    expect(device.unparsedLines).toContain("some-unknown-command foo bar");
  });

  it("preserves the uploaded text verbatim", () => {
    expect(device.sourceText).toBe(MESSY_SWITCH);
  });

  it("falls back to the filename when the config has no hostname", () => {
    const nameless = parseCiscoIosConfig("interface Gi0/1\n ip address 10.0.0.1 255.255.255.0\n", "edge-rtr.cfg");
    expect(nameless.hostname).toBe("edge-rtr");
  });
});

describe("findings from a hand-written config", () => {
  const { findings, design } = importConfigs([{ name: "dist-sw-01.txt", text: MESSY_SWITCH }]);
  const codes = findings.map((f) => f.code);

  it("flags the VLAN that has no layer-3 gateway anywhere", () => {
    const vlan99 = findings.find((f) => f.code === "vlan-without-gateway" && f.message.includes("VLAN 99"));
    expect(vlan99).toBeDefined();
    expect(vlan99?.severity).toBe("warning");
  });

  it("flags an HSRP group whose peer wasn't uploaded", () => {
    expect(codes).toContain("hsrp-single-member");
  });

  it("flags the shut-down trunk and the point-to-point peer that wasn't uploaded", () => {
    expect(codes).toContain("interface-shutdown");
    expect(codes).toContain("peer-not-uploaded");
  });

  it("documents VLAN 99 in findings but does not invent a subnet for it", () => {
    // The config gives VLAN 99 no address, so it cannot become a segment —
    // inventing a range would be fabricating design detail.
    expect(design.segments.map((s) => s.vlanId)).toEqual([10, 20]);
  });

  it("records the role interpretation as an assumption the engineer can correct", () => {
    expect(design.meta.assumptions?.some((a) => a.includes("DIST-SW-01") && a.includes("distribution-switch"))).toBe(true);
  });
});

describe("vendor detection", () => {
  it("accepts a cisco-ios config", () => {
    expect(detectVendor(MESSY_SWITCH)).toBe("cisco-ios");
  });

  it("refuses a FortiGate config rather than half-parsing it into a misleading design", () => {
    const fortigate = 'config system interface\n edit "port1"\n  set mode dhcp\n next\nend\n';
    expect(detectVendor(fortigate)).toBeNull();
    expect(() => importConfigs([{ name: "fw.conf", text: fortigate }])).toThrow(UnsupportedConfigError);
  });

  it("rejects empty uploads and empty file lists", () => {
    expect(() => importConfigs([])).toThrow(UnsupportedConfigError);
    expect(() => importConfigs([{ name: "x.txt", text: "   " }])).toThrow(/empty/);
  });
});

describe("ip helpers", () => {
  it("converts contiguous netmasks to prefix lengths and rejects non-contiguous ones", () => {
    expect(netmaskToPrefixLength("255.255.255.0")).toBe(24);
    expect(netmaskToPrefixLength("255.255.255.254")).toBe(31);
    expect(netmaskToPrefixLength("255.255.255.255")).toBe(32);
    expect(netmaskToPrefixLength("0.0.0.0")).toBe(0);
    expect(netmaskToPrefixLength("255.0.255.0")).toBeNull();
  });

  it("keeps host bits in toCidr but masks them in networkOf", () => {
    expect(toCidr("10.1.10.2", "255.255.255.0")).toBe("10.1.10.2/24");
    expect(networkOf("10.1.10.2/24")).toBe("10.1.10.0/24");
    expect(networkOf("10.1.0.1/30")).toBe("10.1.0.0/30");
  });
});

describe("parseVlanList", () => {
  it("expands comma lists and ranges", () => {
    expect(parseVlanList("10,20,30")).toEqual([10, 20, 30]);
    expect(parseVlanList("10-12,20")).toEqual([10, 11, 12, 20]);
  });
});
