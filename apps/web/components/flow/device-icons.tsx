import {
  ArrowLeftRight,
  Box,
  Cloud,
  Globe,
  Lock,
  Network,
  Router,
  Scale,
  Server,
  ShieldAlert,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { DeviceRole } from "@netdesign/schema";

const ICONS: Record<DeviceRole, LucideIcon> = {
  router: Router,
  "core-switch": Network,
  "distribution-switch": Network,
  "access-switch": Network,
  firewall: ShieldAlert,
  "load-balancer": Scale,
  "wireless-controller": Wifi,
  "access-point": Wifi,
  server: Server,
  "cloud-gateway": Cloud,
  "vpn-concentrator": Lock,
  "reverse-proxy": ArrowLeftRight,
  internet: Globe,
  generic: Box,
};

export function deviceRoleIcon(role: DeviceRole): LucideIcon {
  return ICONS[role] ?? Box;
}
