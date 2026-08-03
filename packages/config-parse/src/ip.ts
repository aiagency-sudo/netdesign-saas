/**
 * Minimal IPv4 helpers for turning parsed config text back into CIDR, and for
 * deciding which interfaces share a subnet (how physical links are inferred).
 * Self-contained on purpose — this package parses, it doesn't allocate, so it
 * has no reason to depend on design-engine's allocation math.
 */

export function isIpv4(value: string): boolean {
  const octets = value.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

export function ipToInt(ip: string): number {
  const [a, b, c, d] = ip.split(".").map(Number) as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

/** Converts a dotted netmask (255.255.255.0) to a prefix length (24). Returns null for non-contiguous masks. */
export function netmaskToPrefixLength(netmask: string): number | null {
  if (!isIpv4(netmask)) return null;
  const bits = ipToInt(netmask);
  // A valid mask is a run of 1s then 0s: inverting +1 must be a power of two.
  const inverted = (~bits) >>> 0;
  if (((inverted + 1) & inverted) !== 0) return null;
  let count = 0;
  for (let i = 31; i >= 0; i--) {
    if ((bits >>> i) & 1) count++;
    else break;
  }
  return count;
}

/** "10.0.1.5" + "255.255.255.0" -> "10.0.1.5/24" (host bits preserved — this is the device's own address). */
export function toCidr(ip: string, netmask: string): string | null {
  const prefixLength = netmaskToPrefixLength(netmask);
  if (prefixLength === null || !isIpv4(ip)) return null;
  return `${ip}/${prefixLength}`;
}

/** The network base of a host CIDR: "10.0.1.5/24" -> "10.0.1.0/24". Used to group interfaces onto a shared subnet. */
export function networkOf(cidr: string): string | null {
  const [ip, prefixStr] = cidr.split("/");
  if (!ip || prefixStr === undefined || !isIpv4(ip)) return null;
  const prefixLength = Number(prefixStr);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) return null;
  const maskBits = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return `${intToIp((ipToInt(ip) & maskBits) >>> 0)}/${prefixLength}`;
}

/** Strips the prefix from a CIDR: "10.0.1.5/24" -> "10.0.1.5". */
export function addressOf(cidr: string): string {
  return cidr.split("/")[0] ?? cidr;
}
