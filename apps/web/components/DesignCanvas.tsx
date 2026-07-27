"use client";

import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Design } from "@netdesign/schema";
import { designToFlow } from "@/lib/design-to-flow";
import { DeviceNode } from "./flow/DeviceNode";

const nodeTypes: NodeTypes = { device: DeviceNode };

// Warm/editorial palette to match the landing-page hero: hairline links,
// mono-ish labels on a cream artboard. No Controls or MiniMap chrome.
const defaultEdgeOptions = {
  type: "smoothstep" as const,
  style: { stroke: "#cfcdc4", strokeWidth: 1.25 },
  labelStyle: { fontSize: 10, fill: "#807d72", fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
  labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
};

export function DesignCanvas({ design }: { design: Design }) {
  const { nodes, edges } = useMemo(() => designToFlow(design), [design]);

  return (
    <div className="h-[70vh] w-full overflow-hidden rounded-xl border border-[#e6e5e0] bg-[#f7f7f4]">
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
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#dedcd3" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
