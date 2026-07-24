import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/components/ProjectTabs";
import { RegenerateForm } from "@/components/RegenerateForm";
import type { VersionSummary } from "@/components/VersionHistory";

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

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
          <p className="whitespace-pre-wrap text-sm text-slate-500">{project.prompt}</p>
        </div>
        {project.design_json && (
          <div className="flex shrink-0 items-start gap-2">
            <RegenerateForm projectId={project.id} initialPrompt={project.prompt} />
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
        />
      ) : (
        <p className="text-sm text-slate-500">No design generated yet.</p>
      )}
    </main>
  );
}
