import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/components/ProjectTabs";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
          <p className="whitespace-pre-wrap text-sm text-slate-500">{project.prompt}</p>
        </div>
        {project.design_json && (
          <a
            href={`/api/projects/${project.id}/export`}
            className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Download .vsdx
          </a>
        )}
      </div>
      {project.design_json ? (
        <ProjectTabs design={project.design_json} />
      ) : (
        <p className="text-sm text-slate-500">No design generated yet.</p>
      )}
    </main>
  );
}
