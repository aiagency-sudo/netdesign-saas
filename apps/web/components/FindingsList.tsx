import type { Finding } from "@netdesign/config-parse";

/**
 * Advisory observations about an imported configuration.
 *
 * Deliberately styled and worded as commentary, NOT as design output: findings
 * describe things the engineer may want to look at in their own configuration.
 * The uploaded config is the source of truth and is never changed, so nothing
 * here is a fix to apply, and no generated configuration lines are ever shown.
 */
export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No advisory findings — nothing in the uploaded configuration stood out for review.
      </p>
    );
  }

  const warnings = findings.filter((finding) => finding.severity === "warning");
  const infos = findings.filter((finding) => finding.severity !== "warning");

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        These are observations about the configuration you uploaded — things you may want to review. Your
        configuration has not been changed, and no replacement configuration was generated.
      </p>

      {warnings.length > 0 && <Group title="Worth reviewing" findings={warnings} tone="warning" />}
      {infos.length > 0 && <Group title="For your information" findings={infos} tone="info" />}
    </div>
  );
}

function Group({ title, findings, tone }: { title: string; findings: Finding[]; tone: "warning" | "info" }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({findings.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {findings.map((finding, index) => (
          <li
            key={`${finding.code}-${index}`}
            className={`rounded-md border px-4 py-3 text-sm ${
              tone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            <p>{finding.message}</p>
            <p className="mt-1 text-xs opacity-70">
              {finding.devices.join(", ")} · {finding.code}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
