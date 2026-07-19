import type { Edge } from "@xyflow/react";
import type { Design } from "@netdesign/schema";
import type { DeviceNodeType } from "@/components/flow/DeviceNode";
import type { ZoneNodeType } from "@/components/flow/ZoneNode";

const UNASSIGNED_ZONE = "Ungrouped";
const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 72;
const ZONE_PADDING = 32;
const ZONE_HEADER_HEIGHT = 32;
const ZONE_GAP_X = 80;
const MAX_COLUMNS_PER_ZONE = 3;

export type FlowNode = DeviceNodeType | ZoneNodeType;

export interface DesignFlow {
  nodes: FlowNode[];
  edges: Edge[];
}

/**
 * Pure conversion from a validated design JSON to React Flow nodes/edges.
 * Devices are grouped into one "zone" group node per distinct `device.zone`
 * (devices without a zone land in a shared "Ungrouped" group), laid out as
 * a wrapping grid within their zone, with zones placed left-to-right.
 */
export function designToFlow(design: Design): DesignFlow {
  const zoneOrder: string[] = [];
  const devicesByZone = new Map<string, Design["devices"]>();

  for (const device of design.devices) {
    const zone = device.zone ?? UNASSIGNED_ZONE;
    let bucket = devicesByZone.get(zone);
    if (!bucket) {
      bucket = [];
      devicesByZone.set(zone, bucket);
      zoneOrder.push(zone);
    }
    bucket.push(device);
  }

  const nodes: FlowNode[] = [];
  let zoneX = 0;

  for (const zone of zoneOrder) {
    const devices = devicesByZone.get(zone) ?? [];
    const columns = Math.min(MAX_COLUMNS_PER_ZONE, devices.length) || 1;
    const rows = Math.ceil(devices.length / columns);
    const zoneWidth = columns * NODE_WIDTH + (columns - 1) * NODE_GAP_X + ZONE_PADDING * 2;
    const zoneHeight = ZONE_HEADER_HEIGHT + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP_Y + ZONE_PADDING * 2;
    const zoneId = `zone:${zone}`;

    nodes.push({
      id: zoneId,
      type: "zone",
      position: { x: zoneX, y: 0 },
      data: { label: zone },
      style: { width: zoneWidth, height: zoneHeight },
      selectable: false,
      draggable: false,
    });

    devices.forEach((device, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      nodes.push({
        id: device.id,
        type: "device",
        parentId: zoneId,
        extent: "parent",
        position: {
          x: ZONE_PADDING + col * (NODE_WIDTH + NODE_GAP_X),
          y: ZONE_HEADER_HEIGHT + ZONE_PADDING + row * (NODE_HEIGHT + NODE_GAP_Y),
        },
        data: { device },
      });
    });

    zoneX += zoneWidth + ZONE_GAP_X;
  }

  const deviceIds = new Set(design.devices.map((device) => device.id));
  const edges: Edge[] = [];

  design.links.forEach((link, index) => {
    const [aId, aInterface] = splitEndpoint(link.a);
    const [bId, bInterface] = splitEndpoint(link.b);
    if (!deviceIds.has(aId) || !deviceIds.has(bId)) {
      return; // link end points outside the design (e.g. an ISP hop) — nothing to draw it to
    }
    edges.push({
      id: `link-${index}`,
      source: aId,
      target: bId,
      label: [aInterface, bInterface].filter(Boolean).join(" ↔ "),
      type: "smoothstep",
    });
  });

  return { nodes, edges };
}

function splitEndpoint(endpoint: string): [string, string | undefined] {
  const [id, iface] = endpoint.split(":");
  return [id ?? endpoint, iface];
}
