"use client";

import { useState, type ReactNode } from "react";
import type { Design } from "@netdesign/schema";
import { DesignCanvas } from "./DesignCanvas";
import { IpPlanTable } from "./IpPlanTable";

type Tab = "diagram" | "ip-plan";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-3 py-2 text-sm font-medium ${
        active
          ? "border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100"
          : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export function ProjectTabs({ design }: { design: Design }) {
  const [tab, setTab] = useState<Tab>("diagram");

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <TabButton active={tab === "diagram"} onClick={() => setTab("diagram")}>
          Diagram
        </TabButton>
        <TabButton active={tab === "ip-plan"} onClick={() => setTab("ip-plan")}>
          IP Plan
        </TabButton>
      </div>
      {tab === "diagram" ? <DesignCanvas design={design} /> : <IpPlanTable design={design} />}
    </div>
  );
}
