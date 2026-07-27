"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Device } from "@netdesign/schema";
import { deviceRoleIcon } from "./device-icons";
import { roleAccent, roleLabel } from "./role-meta";

export type DeviceNodeType = Node<{ device: Device }, "device">;

/**
 * Four handles so the hierarchical layout can route each link cleanly: links
 * to a higher tier leave the top, links to a lower tier leave the bottom, and
 * same-tier links (e.g. an HSRP router pair) go side-to-side. design-to-flow
 * picks the right pair of handle ids per edge, so each handle only ever plays
 * its declared source/target role.
 */
export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  const { device } = data;
  const Icon = deviceRoleIcon(device.role);
  const accent = roleAccent(device.role);
  const subtitle = [roleLabel(device.role), device.zone].filter(Boolean).join(" · ");

  return (
    <div
      className={`flex w-44 items-center gap-2.5 rounded-lg border border-l-4 border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${accent.bar}`}
    >
      <Handle id="t" type="target" position={Position.Top} className="!bg-slate-400" />
      <Handle id="l" type="target" position={Position.Left} className="!bg-slate-400" />
      {/* eslint-disable-next-line react-hooks/static-components -- Icon comes from a stable, module-level role->icon lookup table, not a fresh component per render. */}
      <Icon className={`h-5 w-5 shrink-0 ${accent.icon}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {device.hostname ?? device.id}
        </div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
      </div>
      {device.redundancyGroup && (
        <span
          title={`Redundancy group: ${device.redundancyGroup}`}
          className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700 dark:text-slate-300"
        >
          HA
        </span>
      )}
      <Handle id="r" type="source" position={Position.Right} className="!bg-slate-400" />
      <Handle id="b" type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}
