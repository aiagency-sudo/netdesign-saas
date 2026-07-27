"use client";

import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Design } from "@netdesign/schema";
import { designToFlow } from "@/lib/design-to-flow";
import { DeviceNode, type DeviceNodeType } from "./flow/DeviceNode";
import { roleAccent } from "./flow/role-meta";

const nodeTypes: NodeTypes = { device: DeviceNode };

const defaultEdgeOptions = {
  type: "smoothstep" as const,
  style: { stroke: "#94a3b8", strokeWidth: 1.5 },
  labelStyle: { fontSize: 10, fill: "#64748b" },
  labelBgStyle: { fill: "#ffffff", fillOpacity: 0.85 },
};

export function DesignCanvas({ design }: { design: Design }) {
  const { nodes, edges } = useMemo(() => designToFlow(design), [design]);

  return (
    <div className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => roleAccent((node as DeviceNodeType).data.device.role).mini}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
