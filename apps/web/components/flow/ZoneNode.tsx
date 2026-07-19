"use client";

import type { Node, NodeProps } from "@xyflow/react";

export type ZoneNodeType = Node<{ label: string }, "zone">;

export function ZoneNode({ data }: NodeProps<ZoneNodeType>) {
  return (
    <div className="h-full w-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {data.label}
      </div>
    </div>
  );
}
