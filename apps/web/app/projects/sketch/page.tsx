"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import posthog from "posthog-js";
import type { DesignParams, Finding } from "@netdesign/schema";

const ACCEPTED = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.vsdx,.vsdm,.drawio,.svg";
const MAX_FILES = 10;

interface Reading {
  params: DesignParams;
  confidence: "high" | "medium" | "low";
  observations: string[];
  recommendations: Finding[];
  ingestNotes: string[];
  fileManifest: Array<{ name: string; bytes: number }>;
}

/**
 * Sketch import is deliberately two steps: read, then confirm. A diagram is
 * lossy input, so the engineer sees exactly what was read off it — and every
 * correction being recommended — before any design is created. Nothing is
 * saved until they say so.
 */
export default function SketchImportPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "creating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setError(null);
    setFiles((current) => {
      // De-dupe by filename so re-picking the same file doesn't double it up.
      const byName = new Map(current.map((file) => [file.name, file]));
      for (const file of Array.from(fileList)) byName.set(file.name, file);
      return [...byName.values()].slice(0, MAX_FILES);
    });
  }

  async function handleRead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      setError("Add at least one diagram file.");
      return;
    }
    setStatus("reading");
    setError(null);
    setQuestions(null);
    posthog.capture("sketch_upload_started", { file_count: files.length });

    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (notes.trim()) form.append("notes", notes.trim());

    const response = await fetch("/api/sketch/read", { method: "POST", body: form });
    const body = (await response.json()) as Partial<Reading> & {
      error?: string;
      needsClarification?: boolean;
      questions?: string[];
    };

    setStatus("idle");
    if (body.needsClarification && body.questions) {
      setQuestions(body.questions);
      return;
    }
    if (!response.ok || !body.params) {
      setError(body.error ?? "Could not read that diagram.");
      return;
    }
    setReading(body as Reading);
  }

  async function handleCreate() {
    if (!reading) return;
    setStatus("creating");
    setError(null);

    const response = await fetch("/api/sketch/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading),
    });
    const body = (await response.json()) as { projectId?: string; error?: string };

    if (!response.ok || !body.projectId) {
      setStatus("idle");
      setError(body.error ?? "Could not create that design.");
      return;
    }
    router.push(`/projects/${body.projectId}`);
  }

  if (reading) {
    return (
      <ReviewStep
        reading={reading}
        busy={status === "creating"}
        error={error}
        onBack={() => {
          setReading(null);
          setError(null);
        }}
        onConfirm={handleCreate}
      />
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Upload a diagram</h1>
      <p className="mb-6 text-sm text-slate-500">
        A photo of a whiteboard, a hand sketch, a Visio or draw.io file, a PDF, or a Word document with the diagram
        pasted in. You&apos;ll see exactly what was read — and anything we&apos;d suggest changing — before any design
        is created.
      </p>

      <form onSubmit={handleRead} className="flex flex-col gap-4">
        <div
          onDragOver={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center ${
            dragging ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-900" : "border-slate-300 dark:border-slate-600"
          }`}
        >
          <p className="text-sm font-medium">Drop your diagram here, or click to choose files</p>
          <p className="mt-1 text-xs text-slate-500">PNG, JPEG, GIF, WebP, PDF, Word (.docx), Visio (.vsdx), draw.io, SVG</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="hidden"
            onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="font-mono text-xs">{file.name}</span>
                <span className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Anything the drawing doesn&apos;t say (optional)</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="e.g. the dotted link is planned, not built. Site is called Leeds Office."
            className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </label>

        {questions && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="mb-1 font-medium">That diagram couldn&apos;t be read confidently. Before trying again:</p>
            <ul className="list-inside list-disc">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">Add the answers to the notes box above, or upload a clearer image.</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={status === "reading"}
          className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {status === "reading" ? "Reading the diagram…" : "Read the diagram"}
        </button>
      </form>
    </main>
  );
}

const CONFIDENCE_COPY: Record<Reading["confidence"], { label: string; className: string; blurb: string }> = {
  high: {
    label: "Read with high confidence",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
    blurb: "Every device and link in the diagram was identified.",
  },
  medium: {
    label: "Read with medium confidence",
    className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
    blurb: "The shape of the network is clear, but some details were inferred. Check the reading below carefully.",
  },
  low: {
    label: "Read with low confidence",
    className: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
    blurb: "Parts of this diagram were hard to read. Check every line below before continuing.",
  },
};

function ReviewStep({
  reading,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  reading: Reading;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const confidence = CONFIDENCE_COPY[reading.confidence];
  const warnings = reading.recommendations.filter((item) => item.severity === "warning");
  const suggestions = reading.recommendations.filter((item) => item.severity !== "warning");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Check what we read</h1>
      <p className="mb-6 text-sm text-slate-500">
        Nothing has been created yet. The design below is <strong>what your diagram shows</strong> — including anything
        missing from it. Suggested changes are listed separately for you to decide on; they have not been applied.
      </p>

      <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${confidence.className}`}>
        <p className="font-medium">{confidence.label}</p>
        <p className="text-xs">{confidence.blurb}</p>
      </div>

      <Section title="What the diagram shows">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Fact label="Site" value={reading.params.siteName} />
          <Fact label="Pattern" value={reading.params.designPattern} />
          <Fact label="Routers" value={`${reading.params.router.count} (${reading.params.router.redundancy})`} />
          <Fact label="Access switches" value={String(reading.params.accessSwitch.count)} />
          <Fact label="Firewall" value={reading.params.firewall.present ? reading.params.firewall.vendorHint : "none drawn"} />
          <Fact label="VLANs" value={reading.params.vlans.map((vlan) => vlan.name).join(", ")} />
        </dl>
      </Section>

      {reading.observations.length > 0 && (
        <Section title="Read from the diagram">
          <ul className="list-inside list-disc text-sm text-slate-600 dark:text-slate-300">
            {reading.observations.map((observation) => (
              <li key={observation}>{observation}</li>
            ))}
          </ul>
        </Section>
      )}

      {reading.params.assumptions.length > 0 && (
        <Section title="Assumed, because the diagram didn't say">
          <ul className="list-inside list-disc text-sm text-slate-600 dark:text-slate-300">
            {reading.params.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </Section>
      )}

      {reading.recommendations.length > 0 && (
        <Section title="Recommended changes — your call, not applied">
          <div className="flex flex-col gap-2">
            {[...warnings, ...suggestions].map((item) => (
              <div
                key={`${item.code}-${item.message}`}
                className={`rounded-md border px-3 py-2 text-sm ${
                  item.severity === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                <p>{item.message}</p>
                {item.devices.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] opacity-70">{item.devices.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            These are kept with the project so you can act on them later. To take one up, change your diagram (or the
            design once it exists) — we won&apos;t make the change for you.
          </p>
        </Section>
      )}

      {reading.ingestNotes.length > 0 && (
        <Section title="How your files were read">
          <ul className="list-inside list-disc text-xs text-slate-500">
            {reading.ingestNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Section>
      )}

      {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {busy ? "Creating…" : "Looks right — create the design"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300"
        >
          Back
        </button>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
