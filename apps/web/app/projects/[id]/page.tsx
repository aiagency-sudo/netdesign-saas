import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DesignCanvas } from "@/components/DesignCanvas";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
      <p className="mb-6 whitespace-pre-wrap text-sm text-slate-500">{project.prompt}</p>
      {project.design_json ? (
        <DesignCanvas design={project.design_json} />
      ) : (
        <p className="text-sm text-slate-500">No design generated yet.</p>
      )}
    </main>
  );
}
