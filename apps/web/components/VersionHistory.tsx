"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface VersionSummary {
  id: string;
  prompt: string;
  createdAt: string;
}

export function VersionHistory({
  projectId,
  versions,
  currentVersionId,
}: {
  projectId: string;
  versions: VersionSummary[];
  currentVersionId: string | null;
}) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    setError(null);

    const response = await fetch(`/api/projects/${projectId}/versions/${versionId}/restore`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not restore that version.");
      setRestoringId(null);
      return;
    }

    router.refresh();
    setRestoringId(null);
  }

  if (versions.length === 0) {
    return <p className="text-sm text-slate-500">No version history yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-2">
        {versions.map((version) => {
          const isCurrent = version.id === currentVersionId;
          return (
            <li
              key={version.id}
              className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 dark:border-slate-700"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-700 dark:text-slate-300">{version.prompt}</p>
                <p className="text-xs text-slate-500">{new Date(version.createdAt).toLocaleString()}</p>
              </div>
              {isCurrent ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  Current
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleRestore(version.id)}
                  disabled={restoringId === version.id}
                  className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  {restoringId === version.id ? "Restoring..." : "Restore"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
