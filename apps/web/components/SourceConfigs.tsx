"use client";

import { useState } from "react";
import type { FileParseCoverage } from "@netdesign/config-parse";

export interface SourceConfig {
  name: string;
  text: string;
}

/**
 * Read-only view of the configuration files the user uploaded, stored verbatim.
 * Present because an imported project's source of truth is the customer's own
 * configuration — the documentation is derived from it, never the other way
 * round — so it must always be retrievable, byte for byte, next to the design.
 *
 * Each file also carries its parser coverage: how many lines were read and
 * exactly which ones weren't understood. "We documented your network" is only
 * trustworthy if the gaps are visible, and an unrecognised line is a line the
 * diagram, HLD and .vsdx do not reflect.
 */
export function SourceConfigs({
  configs,
  coverage = [],
}: {
  configs: SourceConfig[];
  coverage?: FileParseCoverage[];
}) {
  const [openName, setOpenName] = useState<string | null>(configs[0]?.name ?? null);

  if (configs.length === 0) {
    return <p className="text-sm text-slate-500">This project wasn&apos;t created from uploaded configuration.</p>;
  }

  const open = configs.find((config) => config.name === openName) ?? configs[0]!;
  const openCoverage = coverage.find((entry) => entry.name === open.name);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        The files you uploaded, exactly as provided. Nothing here has been modified.
      </p>

      <div className="flex flex-wrap gap-1">
        {configs.map((config) => {
          const unread = coverage.find((entry) => entry.name === config.name)?.unrecognisedLines.length ?? 0;
          return (
            <button
              key={config.name}
              type="button"
              onClick={() => setOpenName(config.name)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                config.name === open.name
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
              }`}
            >
              {config.name}
              {unread > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {openCoverage && <CoveragePanel coverage={openCoverage} />}

      <pre className="max-h-[32rem] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900">
        {open.text}
      </pre>
    </div>
  );
}

function CoveragePanel({ coverage }: { coverage: FileParseCoverage }) {
  const [expanded, setExpanded] = useState(false);
  const unread = coverage.unrecognisedLines.length;

  if (unread === 0) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
        All {coverage.consideredLines} configuration lines in this file were read and are reflected in the
        documentation.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <strong className="font-semibold">
            {unread} of {coverage.consideredLines} lines
          </strong>{" "}
          weren&apos;t recognised by the parser, so they aren&apos;t reflected in the diagram, HLD or .vsdx. Your
          configuration itself is unchanged.
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded border border-amber-300 px-2 py-0.5 font-medium dark:border-amber-800"
        >
          {expanded ? "Hide" : "Show"} lines
        </button>
      </div>
      {expanded && (
        <pre className="mt-2 max-h-64 overflow-auto rounded border border-amber-200 bg-white/70 p-2 font-mono text-[11px] leading-relaxed dark:border-amber-900/50 dark:bg-black/20">
          {coverage.unrecognisedLines.join("\n")}
        </pre>
      )}
    </div>
  );
}
