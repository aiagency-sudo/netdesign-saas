"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import posthog from "posthog-js";

export function RegenerateForm({ projectId, initialPrompt }: { projectId: string; initialPrompt: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("generating");
    setError(null);
    setQuestions(null);

    posthog.capture("design_regeneration_started", {
      project_id: projectId,
      prompt_length: prompt.length,
    });

    const response = await fetch(`/api/projects/${projectId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        needsClarification?: boolean;
        questions?: string[];
      } | null;
      setStatus("error");
      if (body?.needsClarification && body.questions) {
        setQuestions(body.questions);
      } else {
        setError(body?.error ?? "Something went wrong.");
      }
      return;
    }

    setStatus("idle");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-300"
      >
        Regenerate
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-2">
      <textarea
        required
        rows={4}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={status === "generating"}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "generating" ? "Regenerating..." : "Regenerate design"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-300"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {questions && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="mb-1 font-medium">Before regenerating, could you clarify:</p>
          <ul className="list-inside list-disc">
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <p className="mt-1 text-amber-700">Add these details above and try again.</p>
        </div>
      )}
    </form>
  );
}
