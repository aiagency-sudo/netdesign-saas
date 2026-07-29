import { describe, expect, it } from "vitest";
import { cidrToIpAndMask, cidrToNetworkAndWildcard, invertMask } from "../src/cidr.js";

describe("cidrToIpAndMask", () => {
  it.each([
    ["10.30.2.2/24", "10.30.2.2", "255.255.255.0"],
    ["10.30.1.5/31", "10.30.1.5", "255.255.255.254"],
    ["10.30.1.0/32", "10.30.1.0", "255.255.255.255"],
    ["10.0.0.0/16", "10.0.0.0", "255.255.0.0"],
    ["10.0.0.0/8", "10.0.0.0", "255.0.0.0"],
    ["10.0.0.0/0", "10.0.0.0", "0.0.0.0"],
  ])("converts %s to ip %s / netmask %s", (cidr, expectedIp, expectedNetmask) => {
    expect(cidrToIpAndMask(cidr)).toEqual({ ip: expectedIp, netmask: expectedNetmask });
  });

  it("rejects malformed CIDR", () => {
    expect(() => cidrToIpAndMask("not-a-cidr")).toThrow(/Not valid CIDR notation/);
    expect(() => cidrToIpAndMask("10.0.0.0/33")).toThrow(/Not a valid CIDR prefix length/);
  });
});

describe("cidrToNetworkAndWildcard", () => {
  it.each([
    // Masks host bits off — an SVI host address yields its VLAN network base.
    ["10.20.2.2/24", "10.20.2.0", "0.0.0.255"],
    // /31 point-to-point link: base is the lower of the two hosts.
    ["10.20.1.22/31", "10.20.1.22", "0.0.0.1"],
    ["10.20.1.23/31", "10.20.1.22", "0.0.0.1"],
    // /32 loopback is its own network.
    ["10.20.1.5/32", "10.20.1.5", "0.0.0.0"],
    ["10.20.0.0/16", "10.20.0.0", "0.0.255.255"],
  ])("converts %s to network %s / wildcard %s", (cidr, network, wildcard) => {
    expect(cidrToNetworkAndWildcard(cidr)).toEqual({ network, wildcard });
  });

  it("rejects malformed input", () => {
    expect(() => cidrToNetworkAndWildcard("nope")).toThrow(/Not valid CIDR notation/);
    expect(() => cidrToNetworkAndWildcard("10.0.0.0/33")).toThrow(/Not a valid CIDR prefix length/);
    expect(() => cidrToNetworkAndWildcard("10.0.0/24")).toThrow(/Not a valid IPv4 address/);
  });
});

describe("invertMask", () => {
  it("computes the OSPF wildcard mask for common netmasks", () => {
    expect(invertMask("255.255.255.0")).toBe("0.0.0.255");
    expect(invertMask("255.255.0.0")).toBe("0.0.255.255");
    expect(invertMask("255.255.255.254")).toBe("0.0.0.1");
  });
});
