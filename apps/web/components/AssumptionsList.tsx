import type { Design } from "@netdesign/schema";

/** Surfaces meta.assumptions/meta.warnings — generated during LLM extraction and composition, but not displayed anywhere until now. */
export function AssumptionsList({ design }: { design: Design }) {
  const assumptions = design.meta.assumptions ?? [];
  const warnings = design.meta.warnings ?? [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 text-lg font-semibold">Intent</h2>
        <p className="text-sm text-slate-700 dark:text-slate-300">{design.meta.intentSummary}</p>
        {design.meta.designPattern && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pattern: {design.meta.designPattern}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Assumptions</h2>
        {assumptions.length === 0 ? (
          <p className="text-sm text-slate-500">No assumptions were recorded for this design.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        )}
      </section>

      {warnings.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-amber-700 dark:text-amber-500">Warnings</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-500">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
