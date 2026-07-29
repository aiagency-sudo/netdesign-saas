"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

export function LoginForm({ initialError, next }: { initialError: string | null; next: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    // Requesting a fresh link clears any failure carried over from a previous attempt.
    setError(null);

    // Preserve the ?next= destination (e.g. the landing CTA sends
    // ?next=/projects/new) through the magic link so the user lands on the
    // intended page after sign-in.
    const callback = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback },
    });

    if (signInError) {
      setStatus("idle");
      setError(signInError.message);
      return;
    }

    posthog.capture("magic_link_requested");
    setStatus("sent");
  }

  return (
    <>
      {/* Above the form so a failed callback is the first thing the user reads. */}
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {status === "sent" ? (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p>Check {email} for a sign-in link.</p>
          <p className="mt-2 text-emerald-700">
            Open it in this browser — the link is single-use and expires shortly.
          </p>
        </div>
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
        </form>
      )}
    </>
  );
}
