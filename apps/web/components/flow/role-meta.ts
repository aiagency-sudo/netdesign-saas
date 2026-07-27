import type { DeviceRole } from "@netdesign/schema";

/**
 * Vertical tier for each role, smaller = higher in the diagram. Drives the
 * hierarchical top-down layout (internet → firewall → routers → switches →
 * endpoints) so the canvas reads like a real network diagram instead of a
 * flat grid. Ranks are compacted at layout time — empty tiers leave no gap —
 * so the absolute numbers only need to encode the north-to-south ordering.
 */
const RANK: Record<DeviceRole, number> = {
  internet: 0,
  "cloud-gateway": 1,
  firewall: 1,
  "vpn-concentrator": 1,
  "reverse-proxy": 2,
  "load-balancer": 2,
  router: 3,
  "core-switch": 4,
  "distribution-switch": 5,
  "wireless-controller": 5,
  "access-switch": 6,
  "access-point": 7,
  server: 7,
  generic: 7,
};

const LABEL: Record<DeviceRole, string> = {
  router: "Router",
  "core-switch": "Core switch",
  "distribution-switch": "Distribution switch",
  "access-switch": "Access switch",
  firewall: "Firewall",
  "load-balancer": "Load balancer",
  "wireless-controller": "Wireless controller",
  "access-point": "Access point",
  server: "Server",
  "cloud-gateway": "Cloud gateway",
  "vpn-concentrator": "VPN concentrator",
  "reverse-proxy": "Reverse proxy",
  internet: "Internet",
  generic: "Device",
};

export interface RoleAccent {
  /** Left accent bar on the device card (a full literal class so Tailwind's JIT keeps it). */
  bar: string;
  /** Icon + emphasis text color. */
  icon: string;
  /** Hex used for the MiniMap dot, which can't take a Tailwind class. */
  mini: string;
}

const ACCENT: Record<DeviceRole, RoleAccent> = {
  internet: { bar: "border-l-sky-500", icon: "text-sky-600 dark:text-sky-400", mini: "#0ea5e9" },
  "cloud-gateway": { bar: "border-l-sky-500", icon: "text-sky-600 dark:text-sky-400", mini: "#0ea5e9" },
  firewall: { bar: "border-l-rose-500", icon: "text-rose-600 dark:text-rose-400", mini: "#f43f5e" },
  "vpn-concentrator": { bar: "border-l-rose-500", icon: "text-rose-600 dark:text-rose-400", mini: "#f43f5e" },
  "reverse-proxy": { bar: "border-l-amber-500", icon: "text-amber-600 dark:text-amber-400", mini: "#f59e0b" },
  "load-balancer": { bar: "border-l-amber-500", icon: "text-amber-600 dark:text-amber-400", mini: "#f59e0b" },
  router: { bar: "border-l-blue-500", icon: "text-blue-600 dark:text-blue-400", mini: "#3b82f6" },
  "core-switch": { bar: "border-l-violet-500", icon: "text-violet-600 dark:text-violet-400", mini: "#8b5cf6" },
  "distribution-switch": { bar: "border-l-violet-500", icon: "text-violet-600 dark:text-violet-400", mini: "#8b5cf6" },
  "access-switch": { bar: "border-l-violet-500", icon: "text-violet-600 dark:text-violet-400", mini: "#8b5cf6" },
  "wireless-controller": { bar: "border-l-cyan-500", icon: "text-cyan-600 dark:text-cyan-400", mini: "#06b6d4" },
  "access-point": { bar: "border-l-cyan-500", icon: "text-cyan-600 dark:text-cyan-400", mini: "#06b6d4" },
  server: { bar: "border-l-emerald-500", icon: "text-emerald-600 dark:text-emerald-400", mini: "#10b981" },
  generic: { bar: "border-l-slate-400", icon: "text-slate-500 dark:text-slate-400", mini: "#94a3b8" },
};

export function roleRank(role: DeviceRole): number {
  return RANK[role] ?? RANK.generic;
}

export function roleLabel(role: DeviceRole): string {
  return LABEL[role] ?? LABEL.generic;
}

export function roleAccent(role: DeviceRole): RoleAccent {
  return ACCENT[role] ?? ACCENT.generic;
}
