"use client";

import { useState } from "react";

export interface SourceConfig {
  name: string;
  text: string;
}

/**
 * Read-only view of the configuration files the user uploaded, stored verbatim.
 * Present because an imported project's source of truth is the customer's own
 * configuration — the documentation is derived from it, never the other way
 * round — so it must always be retrievable, byte for byte, next to the design.
 */
export function SourceConfigs({ configs }: { configs: SourceConfig[] }) {
  const [openName, setOpenName] = useState<string | null>(configs[0]?.name ?? null);

  if (configs.length === 0) {
    return <p className="text-sm text-slate-500">This project wasn&apos;t created from uploaded configuration.</p>;
  }

  const open = configs.find((config) => config.name === openName) ?? configs[0]!;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        The files you uploaded, exactly as provided. Nothing here has been modified.
      </p>

      <div className="flex flex-wrap gap-1">
        {configs.map((config) => (
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
          </button>
        ))}
      </div>

      <pre className="max-h-[32rem] overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900">
        {open.text}
      </pre>
    </div>
  );
}
