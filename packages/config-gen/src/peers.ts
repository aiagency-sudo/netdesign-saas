import type { Design, Device } from "@netdesign/schema";
import { cidrToIpAndMask } from "./cidr.js";

/** Splits a link endpoint ("rtr-01:eth0/0") into its device id and interface name. */
export function splitEndpoint(endpoint: string): [string, string | undefined] {
  const [id, iface] = endpoint.split(":");
  return [id ?? endpoint, iface];
}

/** The device id and interface on the far end of `deviceId`'s `ifaceName` link, or null when that interface isn't linked. */
export function peerEndpointOf(
  deviceId: string,
  ifaceName: string,
  design: Design,
): { deviceId: string; ifaceName: string | undefined } | null {
  for (const link of design.links) {
    const [aId, aIface] = splitEndpoint(link.a);
    const [bId, bIface] = splitEndpoint(link.b);
    if (aId === deviceId && aIface === ifaceName) return { deviceId: bId, ifaceName: bIface };
    if (bId === deviceId && bIface === ifaceName) return { deviceId: aId, ifaceName: aIface };
  }
  return null;
}

/** The device id on the far end of `deviceId`'s `ifaceName` link, or null if that interface isn't linked. */
export function peerDeviceIdOf(deviceId: string, ifaceName: string, design: Design): string | null {
  return peerEndpointOf(deviceId, ifaceName, design)?.deviceId ?? null;
}

/**
 * The IP of the router on the far end of this firewall interface's P2P link —
 * the LAN-ward next hop a firewall points its static routes at. Returns null
 * when the interface isn't linked, or is linked to something that isn't a
 * router (a firewall only ever routes toward the site's routers here).
 *
 * Shared by the FortiGate and PAN-OS view models: both express the same
 * posture (static routes to each VLAN subnet via every router), only the
 * syntax differs.
 */
export function routerPeerIp(device: Device, ifaceName: string, design: Design): string | null {
  const peerEndpoint = peerEndpointOf(device.id, ifaceName, design);
  if (!peerEndpoint) return null;

  const peer = design.devices.find((d) => d.id === peerEndpoint.deviceId);
  if (peer?.role !== "router") return null;

  const iface = (peer.interfaces ?? []).find((i) => i.name === peerEndpoint.ifaceName);
  return iface?.ip ? cidrToIpAndMask(iface.ip).ip : null;
}
