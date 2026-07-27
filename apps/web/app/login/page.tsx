"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    // Preserve a ?next= destination (e.g. the landing-page CTA sends
    // ?next=/projects/new) through the magic link so the user lands on the
    // intended page after sign-in. Read from window (not useSearchParams) to
    // avoid forcing a Suspense boundary on this otherwise-static page.
    const next = new URLSearchParams(window.location.search).get("next");
    const callback = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback },
    });

    if (signInError) {
      setStatus("error");
      setError(signInError.message);
      return;
    }

    posthog.capture("magic_link_requested");
    setStatus("sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-2 text-2xl font-semibold">NetDesign AI</h1>
      <p className="mb-6 text-sm text-slate-500">Sign in with a magic link — no password needed.</p>

      {status === "sent" ? (
        <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Check {email} for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "sending" ? "Sending..." : "Send magic link"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}
    </main>
  );
}
