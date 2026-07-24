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
