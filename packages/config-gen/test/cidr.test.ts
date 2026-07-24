import { describe, expect, it } from "vitest";
import { cidrToIpAndMask, invertMask } from "../src/cidr.js";

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

describe("invertMask", () => {
  it("computes the OSPF wildcard mask for common netmasks", () => {
    expect(invertMask("255.255.255.0")).toBe("0.0.0.255");
    expect(invertMask("255.255.0.0")).toBe("0.0.255.255");
    expect(invertMask("255.255.255.254")).toBe("0.0.0.1");
  });
});
