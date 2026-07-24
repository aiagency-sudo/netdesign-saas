/** Vendor-neutral eth0/N -> cisco-ios's GigabitEthernet0/N — design-schema.json documents this mapping as config-gen's job, not the diagram's. */
export function toCiscoInterfaceName(name: string): string {
  const match = /^eth(\d+)\/(\d+)$/.exec(name);
  if (!match) {
    throw new Error(`Expected a vendor-neutral interface name like "eth0/0", got "${name}".`);
  }
  const [, unit, port] = match;
  return `GigabitEthernet${unit}/${port}`;
}
