"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import posthog from "posthog-js";

interface PendingFile {
  name: string;
  text: string;
}

const ACCEPTED = ".txt,.cfg,.conf,.log,.ios,text/plain";
const MAX_FILES = 25;

export default function ImportConfigPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [siteName, setSiteName] = useState("");
  const [status, setStatus] = useState<"idle" | "importing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setError(null);
    const read = await Promise.all(
      Array.from(fileList).map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    setFiles((current) => {
      // De-dupe by filename so re-picking the same file doesn't double it up.
      const byName = new Map(current.map((file) => [file.name, file]));
      for (const file of read) byName.set(file.name, file);
      return [...byName.values()].slice(0, MAX_FILES);
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Add at least one configuration file.");
      return;
    }
    setStatus("importing");
    setError(null);
    posthog.capture("config_import_started", { file_count: files.length });

    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, ...(siteName.trim() ? { siteName: siteName.trim() } : {}) }),
    });
    const body = (await response.json()) as { projectId?: string; error?: string };

    if (!response.ok || !body.projectId) {
      setStatus("idle");
      setError(body.error ?? "Could not import those configurations.");
      return;
    }

    router.push(`/projects/${body.projectId}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Import existing configuration</h1>
      <p className="mb-6 text-sm text-slate-500">
        Upload the running-config of one or more Cisco IOS devices and get a diagram, an IP plan, and an HLD
        describing the network you already have.{" "}
        <strong className="font-medium text-slate-700 dark:text-slate-300">
          Your configuration is never modified or replaced
        </strong>{" "}
        — this only reads it and documents what it finds.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg border-2 border-dashed px-4 py-8 text-center ${
            dragging ? "border-slate-900 bg-slate-50 dark:border-slate-100" : "border-slate-300 dark:border-slate-600"
          }`}
        >
          <p className="mb-2 text-sm text-slate-600 dark:text-slate-300">
            Drag configuration files here, or
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-600"
          >
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(event: ChangeEvent<HTMLInputElement>) => void addFiles(event.target.files)}
          />
          <p className="mt-3 text-xs text-slate-400">
            One file per device. Upload every device at a site together so links between them can be identified.
          </p>
        </div>

        {files.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-slate-200 p-2 dark:border-slate-700">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between px-2 py-1 text-sm">
                <span className="truncate">
                  {file.name}{" "}
                  <span className="text-xs text-slate-400">
                    ({file.text.split(/\r?\n/).length} lines)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((f) => f.name !== file.name))}
                  className="ml-3 shrink-0 text-xs text-slate-500 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Site name (optional)</span>
          <input
            value={siteName}
            onChange={(event) => setSiteName(event.target.value)}
            placeholder="e.g. Calgary Branch"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
          <span className="text-xs text-slate-400">A configuration file can&apos;t tell us the site&apos;s name.</span>
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "importing"}
          className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "importing" ? "Reading configuration..." : "Generate documentation"}
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-400">
        Cisco IOS / IOS-XE only for now. FortiGate and Palo Alto configurations are rejected rather than
        partially read, so nothing misleading is produced.
      </p>
    </main>
  );
}
