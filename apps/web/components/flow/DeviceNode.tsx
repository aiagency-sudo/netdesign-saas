"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Device } from "@netdesign/schema";
import { deviceRoleIcon } from "./device-icons";

export type DeviceNodeType = Node<{ device: Device }, "device">;

export function DeviceNode({ data }: NodeProps<DeviceNodeType>) {
  const { device } = data;
  const Icon = deviceRoleIcon(device.role);

  return (
    <div
      className="flex w-40 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm dark:border-slate-600 dark:bg-slate-800"
    >
      <Handle type="target" position={Position.Left} />
      {/* eslint-disable-next-line react-hooks/static-components -- Icon comes from a stable, module-level role->icon lookup table, not a fresh component per render. */}
      <Icon className="h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {device.hostname ?? device.id}
        </div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{device.role}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
