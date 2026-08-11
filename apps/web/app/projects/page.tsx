import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="flex gap-2">
          <Link
            href="/projects/sketch"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
          >
            Upload diagram
          </Link>
          <Link
            href="/projects/import"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
          >
            Import config
          </Link>
          <Link href="/projects/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            New project
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {projects && projects.length === 0 && (
        <p className="text-sm text-slate-500">No projects yet — describe a network to get started.</p>
      )}

      <ul className="flex flex-col gap-2">
        {projects?.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="block rounded-md border border-slate-200 px-4 py-3 hover:border-slate-400"
            >
              <div className="font-medium">{project.name}</div>
              <div className="text-xs text-slate-500">{new Date(project.created_at).toLocaleString()}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
