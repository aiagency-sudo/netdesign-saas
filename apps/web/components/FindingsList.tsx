import type { Finding } from "@netdesign/schema";

/**
 * Advisory observations about imported material.
 *
 * Deliberately styled and worded as commentary, NOT as design output. Two
 * sources share this list and the same rule holds for both: nothing here has
 * been applied, and no generated configuration is ever shown.
 *  - config-import: things to look at in the configuration you uploaded, which
 *    is the source of truth and is never rewritten.
 *  - sketch-import: corrections recommended for the diagram you uploaded. The
 *    design reflects what you drew; taking up a recommendation is your call.
 */
export function FindingsList({ findings, source = "config" }: { findings: Finding[]; source?: "config" | "sketch" }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {source === "sketch"
          ? "No recommended changes — nothing in the diagram stood out for review."
          : "No advisory findings — nothing in the uploaded configuration stood out for review."}
      </p>
    );
  }

  const warnings = findings.filter((finding) => finding.severity === "warning");
  const infos = findings.filter((finding) => finding.severity !== "warning");

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
        {source === "sketch"
          ? "These are changes we would recommend to the network you drew. None of them have been applied — the design reflects your diagram as it is, and acting on a recommendation is your decision."
          : "These are observations about the configuration you uploaded — things you may want to review. Your configuration has not been changed, and no replacement configuration was generated."}
      </p>

      {warnings.length > 0 && (
        <Group title={source === "sketch" ? "Recommended changes" : "Worth reviewing"} findings={warnings} tone="warning" />
      )}
      {infos.length > 0 && (
        <Group title={source === "sketch" ? "Smaller suggestions" : "For your information"} findings={infos} tone="info" />
      )}
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
