"use client";

import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Design } from "@netdesign/schema";
import { designToFlow } from "@/lib/design-to-flow";
import { DeviceNode } from "./flow/DeviceNode";
import { ZoneNode } from "./flow/ZoneNode";

const nodeTypes: NodeTypes = { device: DeviceNode, zone: ZoneNode };

export function DesignCanvas({ design }: { design: Design }) {
  const { nodes, edges } = useMemo(() => designToFlow(design), [design]);

  return (
    <div className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700">
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
