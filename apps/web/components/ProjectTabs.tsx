"use client";

import { useState, type ReactNode } from "react";
import type { Design } from "@netdesign/schema";
import { AssumptionsList } from "./AssumptionsList";
import { DesignCanvas } from "./DesignCanvas";
import { DeviceListTable } from "./DeviceListTable";
import { IpPlanTable } from "./IpPlanTable";

const TABS = [
  { id: "diagram", label: "Diagram" },
  { id: "ip-plan", label: "IP Plan" },
  { id: "devices", label: "Device List" },
  { id: "assumptions", label: "Assumptions" },
] as const;

type Tab = (typeof TABS)[number]["id"];

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
        {TABS.map(({ id, label }) => (
          <TabButton key={id} active={tab === id} onClick={() => setTab(id)}>
            {label}
          </TabButton>
        ))}
      </div>
      {tab === "diagram" && <DesignCanvas design={design} />}
      {tab === "ip-plan" && <IpPlanTable design={design} />}
      {tab === "devices" && <DeviceListTable design={design} />}
      {tab === "assumptions" && <AssumptionsList design={design} />}
    </div>
  );
}
