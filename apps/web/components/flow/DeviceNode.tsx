"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Device } from "@netdesign/schema";
import { deviceRoleIcon } from "./device-icons";
import { roleLabel } from "./role-meta";

export type DeviceNodeType = Node<{ device: Device }, "device">;

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const HANDLE = "!h-1.5 !w-1.5 !border-0 !bg-[#cfcdc4]";

/**
 * Warm/editorial node to match the landing-page hero: white card, hairline
 * border, mono labels, monochrome ink. Four handles so the hierarchical
 * layout can route links cleanly (top/bottom between tiers, left/right for
 * same-tier pairs like an HSRP router pair); design-to-flow picks the pair.
 */
export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  const { device } = data;
  const Icon = deviceRoleIcon(device.role);
  const subtitle = [roleLabel(device.role), device.zone].filter(Boolean).join(" · ");

  return (
    <div className="flex w-44 items-center gap-2.5 rounded-lg border border-[#e6e5e0] bg-white px-3 py-2">
      <Handle id="t" type="target" position={Position.Top} className={HANDLE} />
      <Handle id="l" type="target" position={Position.Left} className={HANDLE} />
      {/* eslint-disable-next-line react-hooks/static-components -- Icon comes from a stable, module-level role->icon lookup table, not a fresh component per render. */}
      <Icon className="h-5 w-5 shrink-0 text-[#807d72]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[#26251e]" style={{ fontFamily: MONO }}>
          {device.hostname ?? device.id}
        </div>
        <div className="truncate text-[11px] text-[#807d72]" style={{ fontFamily: MONO }}>
          {subtitle}
        </div>
      </div>
      {device.redundancyGroup && (
        <span
          title={`Redundancy group: ${device.redundancyGroup}`}
          className="shrink-0 rounded border border-[#cfcdc4] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#807d72]"
        >
          HA
        </span>
      )}
      <Handle id="r" type="source" position={Position.Right} className={HANDLE} />
      <Handle id="b" type="source" position={Position.Bottom} className={HANDLE} />
    </div>
  );
}
