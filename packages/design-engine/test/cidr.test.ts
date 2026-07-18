import { describe, expect, it } from "vitest";
import { formatCidr, intToIp, ipToInt, parseCidr } from "../src/ip-allocation/cidr.js";

describe("ipToInt / intToIp", () => {
  it("round-trips addresses", () => {
    expect(ipToInt("10.0.0.1")).toBe(10 * 2 ** 24 + 1);
    expect(intToIp(10 * 2 ** 24 + 1)).toBe("10.0.0.1");
    expect(intToIp(ipToInt("255.255.255.255"))).toBe("255.255.255.255");
    expect(intToIp(ipToInt("0.0.0.0"))).toBe("0.0.0.0");
  });

  it("rejects malformed addresses", () => {
    expect(() => ipToInt("10.0.0")).toThrow();
    expect(() => ipToInt("10.0.0.256")).toThrow();
    expect(() => ipToInt("not.an.ip.addr")).toThrow();
  });
});

describe("parseCidr", () => {
  it("parses a well-formed network", () => {
    const parsed = parseCidr("10.20.0.0/16");
    expect(parsed.prefixLength).toBe(16);
    expect(parsed.size).toBe(65536);
    expect(intToIp(parsed.network)).toBe("10.20.0.0");
  });

  it("accepts /31 and /32", () => {
    expect(parseCidr("10.0.1.0/31").size).toBe(2);
    expect(parseCidr("10.0.1.5/32").size).toBe(1);
  });

  it("rejects a non-network address (host bits set)", () => {
    expect(() => parseCidr("10.20.0.5/24")).toThrow(/not a network address/);
  });

  it("rejects an out-of-range prefix length", () => {
    expect(() => parseCidr("10.0.0.0/33")).toThrow();
    expect(() => parseCidr("10.0.0.0/-1")).toThrow();
  });
});

describe("formatCidr", () => {
  it("formats network + prefix back into text", () => {
    expect(formatCidr(ipToInt("10.20.0.0"), 24)).toBe("10.20.0.0/24");
  });
});
