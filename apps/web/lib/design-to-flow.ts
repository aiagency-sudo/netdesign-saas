import type { Edge } from "@xyflow/react";
import type { Design } from "@netdesign/schema";
import type { DeviceNodeType } from "@/components/flow/DeviceNode";
import { roleRank } from "@/components/flow/role-meta";

const NODE_WIDTH = 176;
const NODE_HEIGHT = 64;
const H_GAP = 48; // horizontal gap between devices in the same tier
const V_GAP = 88; // vertical gap between tiers

export type FlowNode = DeviceNodeType;

export interface DesignFlow {
  nodes: FlowNode[];
  edges: Edge[];
}

/**
 * Pure conversion from a validated design JSON to React Flow nodes/edges.
 * Devices are laid out in horizontal tiers by role (internet → firewall →
 * routers → switches → endpoints), each tier centered, so the canvas reads
 * top-to-bottom like a real network diagram. Edges are wired to whichever
 * handles keep the links flowing cleanly: down between tiers, sideways within
 * one (see DeviceNode for the handle ids).
 */
export function designToFlow(design: Design): DesignFlow {
  // Bucket devices by role rank, then compact the ranks so empty tiers leave
  // no vertical gap (a branch office uses firewall/router/access-switch only).
  const byRank = new Map<number, Design["devices"]>();
  for (const device of design.devices) {
    const rank = roleRank(device.role);
    const bucket = byRank.get(rank);
    if (bucket) {
      bucket.push(device);
    } else {
      byRank.set(rank, [device]);
    }
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  const rows = sortedRanks.map((rank) =>
    // Stable order within a tier, keeping redundancy pairs adjacent.
    [...(byRank.get(rank) ?? [])].sort((a, b) =>
      `${a.redundancyGroup ?? ""}:${a.id}`.localeCompare(`${b.redundancyGroup ?? ""}:${b.id}`),
    ),
  );

  const maxRowCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  const totalWidth = maxRowCount * NODE_WIDTH + (maxRowCount - 1) * H_GAP;

  const nodes: FlowNode[] = [];
  const rankById = new Map<string, number>();
  const columnById = new Map<string, number>();

  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * H_GAP;
    const startX = (totalWidth - rowWidth) / 2; // center each tier under the widest one
    row.forEach((device, column) => {
      rankById.set(device.id, sortedRanks[rowIndex]!);
      columnById.set(device.id, column);
      nodes.push({
        id: device.id,
        type: "device",
        position: { x: startX + column * (NODE_WIDTH + H_GAP), y: rowIndex * (NODE_HEIGHT + V_GAP) },
        width: NODE_WIDTH,
        data: { device },
      });
    });
  });

  const deviceIds = new Set(design.devices.map((device) => device.id));
  const edges: Edge[] = [];

  design.links.forEach((link, index) => {
    const [aId, aInterface] = splitEndpoint(link.a);
    const [bId, bInterface] = splitEndpoint(link.b);
    if (!deviceIds.has(aId) || !deviceIds.has(bId)) {
      return; // link end points outside the design (e.g. an ISP hop) — nothing to draw it to
    }

    const label = [aInterface, bInterface].filter(Boolean).join(" ↔ ");
    const rankA = rankById.get(aId)!;
    const rankB = rankById.get(bId)!;

    let source: string;
    let target: string;
    let sourceHandle: string;
    let targetHandle: string;

    if (rankA === rankB) {
      // Same tier: left device sources from its right handle into the right device's left.
      const aIsLeft = (columnById.get(aId) ?? 0) <= (columnById.get(bId) ?? 0);
      source = aIsLeft ? aId : bId;
      target = aIsLeft ? bId : aId;
      sourceHandle = "r";
      targetHandle = "l";
    } else {
      // Different tiers: the higher device (smaller rank) sources downward.
      const aIsHigher = rankA < rankB;
      source = aIsHigher ? aId : bId;
      target = aIsHigher ? bId : aId;
      sourceHandle = "b";
      targetHandle = "t";
    }

    edges.push({ id: `link-${index}`, source, target, sourceHandle, targetHandle, label, type: "smoothstep" });
  });

  return { nodes, edges };
}

function splitEndpoint(endpoint: string): [string, string | undefined] {
  const [id, iface] = endpoint.split(":");
  return [id ?? endpoint, iface];
}
