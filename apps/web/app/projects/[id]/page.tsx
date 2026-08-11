import { notFound } from "next/navigation";
import { fileCoverage, parseUploads, type FileParseCoverage, type Finding } from "@netdesign/config-parse";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/components/ProjectTabs";
import { RegenerateForm } from "@/components/RegenerateForm";
import type { SourceConfig } from "@/components/SourceConfigs";
import type { VersionSummary } from "@/components/VersionHistory";

/**
 * Re-derives parser coverage from the stored uploads rather than persisting it
 * at import time: the parser is deterministic, so re-reading the same bytes
 * gives the same answer, and a coverage number can never go stale against a
 * parser improvement. Parsing is pure string work — no LLM, no network.
 *
 * Returns undefined rather than throwing if the stored uploads can't be
 * re-parsed; coverage is a reporting aid, and losing it must never take the
 * project page down with it.
 */
function parseCoverageOf(configs: SourceConfig[]): FileParseCoverage[] | undefined {
  try {
    return fileCoverage(parseUploads(configs));
  } catch {
    return undefined;
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();

  if (!project) {
    notFound();
  }

  const { data: versionRows } = await supabase
    .from("project_versions")
    .select("id, prompt, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const versions: VersionSummary[] = (versionRows ?? []).map((row) => ({
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
  }));

  const isImport = project.source_kind === "config-import";
  const sourceConfigs = (project.source_configs ?? undefined) as SourceConfig[] | undefined;
  const findings = (project.findings ?? undefined) as Finding[] | undefined;
  const coverage = sourceConfigs ? parseCoverageOf(sourceConfigs) : undefined;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
          {isImport && (
            <p className="mb-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Imported from configuration
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm text-slate-500">{project.prompt}</p>
        </div>
        {project.design_json && (
          <div className="flex shrink-0 items-start gap-2">
            {/* Regenerate is prompt-only: an imported project has no prompt to re-run, and
                re-deriving it must never look like we are rewriting the user's configuration. */}
            {!isImport && <RegenerateForm projectId={project.id} initialPrompt={project.prompt} />}
            <a
              href={`/api/projects/${project.id}/export`}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Download .vsdx
            </a>
            <a
              href={`/api/projects/${project.id}/hld`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
            >
              Download HLD (.docx)
            </a>
            <a
              href={`/api/projects/${project.id}/configs`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
            >
              Download configs
            </a>
          </div>
        )}
      </div>
      {project.design_json ? (
        <ProjectTabs
          projectId={project.id}
          design={project.design_json}
          versions={versions}
          currentVersionId={project.current_version_id}
          {...(findings ? { findings } : {})}
          {...(sourceConfigs ? { sourceConfigs } : {})}
          {...(coverage ? { coverage } : {})}
        />
      ) : (
        <p className="text-sm text-slate-500">No design generated yet.</p>
      )}
    </main>
  );
}
