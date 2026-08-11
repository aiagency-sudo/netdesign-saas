"use client";

import { useState, type ReactNode } from "react";
import type { Design } from "@netdesign/schema";
import type { FileParseCoverage, Finding } from "@netdesign/config-parse";
import { AssumptionsList } from "./AssumptionsList";
import { DesignCanvas } from "./DesignCanvas";
import { DeviceListTable } from "./DeviceListTable";
import { FindingsList } from "./FindingsList";
import { IpPlanTable } from "./IpPlanTable";
import { SourceConfigs, type SourceConfig } from "./SourceConfigs";
import { VersionHistory, type VersionSummary } from "./VersionHistory";

const BASE_TABS = [
  { id: "diagram", label: "Diagram" },
  { id: "ip-plan", label: "IP Plan" },
  { id: "devices", label: "Device List" },
  { id: "assumptions", label: "Assumptions" },
] as const;

/** Only meaningful for a config-import project — hidden entirely for prompt-generated designs. */
const IMPORT_TABS = [
  { id: "findings", label: "Findings" },
  { id: "source", label: "Uploaded config" },
] as const;

const VERSIONS_TAB = { id: "versions", label: "Versions" } as const;

type Tab =
  | (typeof BASE_TABS)[number]["id"]
  | (typeof IMPORT_TABS)[number]["id"]
  | typeof VERSIONS_TAB.id;

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

export function ProjectTabs({
  projectId,
  design,
  versions,
  currentVersionId,
  findings,
  sourceConfigs,
  coverage,
}: {
  projectId: string;
  design: Design;
  versions: VersionSummary[];
  currentVersionId: string | null;
  /** Present only for config-import projects. */
  findings?: Finding[];
  sourceConfigs?: SourceConfig[];
  coverage?: FileParseCoverage[];
}) {
  const [tab, setTab] = useState<Tab>("diagram");
  const isImport = sourceConfigs !== undefined && sourceConfigs.length > 0;
  const tabs = [...BASE_TABS, ...(isImport ? IMPORT_TABS : []), VERSIONS_TAB];
  const warningCount = (findings ?? []).filter((finding) => finding.severity === "warning").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700">
        {tabs.map(({ id, label }) => (
          <TabButton key={id} active={tab === id} onClick={() => setTab(id)}>
            {label}
            {id === "findings" && warningCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                {warningCount}
              </span>
            )}
          </TabButton>
        ))}
      </div>
      {tab === "diagram" && <DesignCanvas design={design} />}
      {tab === "ip-plan" && <IpPlanTable design={design} />}
      {tab === "devices" && <DeviceListTable design={design} />}
      {tab === "assumptions" && <AssumptionsList design={design} />}
      {tab === "findings" && <FindingsList findings={findings ?? []} />}
      {tab === "source" && <SourceConfigs configs={sourceConfigs ?? []} coverage={coverage ?? []} />}
      {tab === "versions" && (
        <VersionHistory projectId={projectId} versions={versions} currentVersionId={currentVersionId} />
      )}
    </div>
  );
}
