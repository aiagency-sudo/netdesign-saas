/**
 * IPv4/CIDR arithmetic using plain (non-bitwise) number math.
 * Addresses fit well within Number.MAX_SAFE_INTEGER, and avoiding `<<`/`>>>`
 * sidesteps their 32-bit *signed* wraparound for values >= 2^31.
 */

export function ipToInt(ip: string): number {
  const octets = ip.split(".");
  if (octets.length !== 4) {
    throw new Error(`Not a valid IPv4 address: "${ip}"`);
  }
  let value = 0;
  for (const octet of octets) {
    const n = Number(octet);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Not a valid IPv4 address: "${ip}"`);
    }
    value = value * 256 + n;
  }
  return value;
}

export function intToIp(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Value out of IPv4 range: ${value}`);
  }
  const o0 = Math.floor(value / 2 ** 24) % 256;
  const o1 = Math.floor(value / 2 ** 16) % 256;
  const o2 = Math.floor(value / 2 ** 8) % 256;
  const o3 = value % 256;
  return `${o0}.${o1}.${o2}.${o3}`;
}

export interface ParsedCidr {
  /** Network address, as an integer. */
  network: number;
  prefixLength: number;
  /** Number of addresses in the block (2^(32-prefixLength)). */
  size: number;
}

export function parseCidr(cidr: string): ParsedCidr {
  const [ipPart, prefixPart] = cidr.split("/");
  if (!ipPart || prefixPart === undefined) {
    throw new Error(`Not valid CIDR notation: "${cidr}"`);
  }
  const prefixLength = Number(prefixPart);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Not a valid CIDR prefix length: "${cidr}"`);
  }
  const ip = ipToInt(ipPart);
  const size = 2 ** (32 - prefixLength);
  const network = Math.floor(ip / size) * size;
  if (network !== ip) {
    throw new Error(
      `"${cidr}" is not a network address — did you mean ${formatCidr(network, prefixLength)}?`,
    );
  }
  return { network, prefixLength, size };
}

export function formatCidr(network: number, prefixLength: number): string {
  return `${intToIp(network)}/${prefixLength}`;
}
