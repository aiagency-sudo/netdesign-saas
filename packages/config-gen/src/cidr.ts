/** Minimal, self-contained CIDR helper — config-gen only needs single-address netmask conversion, not the full block-allocation math design-engine's cidr.ts provides, so it doesn't depend on design-engine at runtime. */
export function cidrToIpAndMask(cidr: string): { ip: string; netmask: string } {
  const [ip, prefixStr] = cidr.split("/");
  if (!ip || prefixStr === undefined) {
    throw new Error(`Not valid CIDR notation: "${cidr}"`);
  }
  const prefixLength = Number(prefixStr);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Not a valid CIDR prefix length: "${cidr}"`);
  }
  const maskBits = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const netmask = [24, 16, 8, 0].map((shift) => (maskBits >>> shift) & 0xff).join(".");
  return { ip, netmask };
}

/** Inverse (host) mask for an OSPF `network` statement's wildcard argument. */
export function invertMask(netmask: string): string {
  return netmask
    .split(".")
    .map((octet) => 255 - Number(octet))
    .join(".");
}

/**
 * The network (base) address and wildcard mask for a CIDR, for an OSPF
 * `network <base> <wildcard> area <n>` statement. Unlike {@link cidrToIpAndMask}
 * (which keeps the host address), this masks the host bits off — so an SVI
 * address like "10.20.2.2/24" yields base "10.20.2.0", a /31 link yields its
 * two-host base, and a /32 loopback yields the host itself.
 */
export function cidrToNetworkAndWildcard(cidr: string): { network: string; wildcard: string } {
  const [ipStr, prefixStr] = cidr.split("/");
  if (!ipStr || prefixStr === undefined) {
    throw new Error(`Not valid CIDR notation: "${cidr}"`);
  }
  const prefixLength = Number(prefixStr);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`Not a valid CIDR prefix length: "${cidr}"`);
  }
  const octets = ipStr.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`Not a valid IPv4 address: "${cidr}"`);
  }
  const ipInt = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  const maskBits = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const netInt = (ipInt & maskBits) >>> 0;
  const wildcardBits = (~maskBits) >>> 0;
  const toDotted = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff).join(".");
  return { network: toDotted(netInt), wildcard: toDotted(wildcardBits) };
}
