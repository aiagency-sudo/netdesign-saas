"use client";

import { useState, type FormEvent } from "react";
import posthog from "posthog-js";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const response = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "landing" }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus("error");
      setError(body?.error ?? "Something went wrong. Please try again.");
      return;
    }

    // Captured client-side so it stays on the same person as the pageview,
    // keeping the landing -> waitlist funnel on one profile.
    posthog.capture("waitlist_joined");
    setStatus("done");
  }

  if (status === "done") {
    return (
      <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        You&rsquo;re on the list — we&rsquo;ll be in touch as beta spots open up.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {status === "submitting" ? "Joining..." : "Join the waitlist"}
      </button>
      {error && <p className="text-sm text-red-600 sm:hidden">{error}</p>}
    </form>
  );
}
