"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import posthog from "posthog-js";

export default function NewProjectPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<string[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("generating");
    setError(null);
    setQuestions(null);

    posthog.capture("design_generation_started", {
      prompt_length: prompt.length,
    });

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const body = (await response.json()) as {
      projectId?: string;
      error?: string;
      needsClarification?: boolean;
      questions?: string[];
    };

    if (!response.ok || !body.projectId) {
      setStatus("error");
      if (body.needsClarification && body.questions) {
        setQuestions(body.questions);
      } else {
        setError(body.error ?? "Something went wrong.");
      }
      return;
    }

    router.push(`/projects/${body.projectId}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Describe your network</h1>
      <p className="mb-6 text-sm text-slate-500">
        Plain English is fine — routers, switches, firewalls, VLANs, redundancy. NetDesign.app turns it into a
        validated design.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required
          rows={8}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="We need a branch office design: two redundant routers running HSRP, each uplinked to its own access switch, with a firewall at the edge..."
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "generating"}
          className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "generating" ? "Generating design..." : "Generate design"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {questions && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="mb-1 font-medium">Before generating, could you clarify:</p>
            <ul className="list-inside list-disc">
              {questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
            <p className="mt-1 text-amber-700">Add these details to the description above and try again.</p>
          </div>
        )}
      </form>
    </main>
  );
}
