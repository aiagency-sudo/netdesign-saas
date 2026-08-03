"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import posthog from "posthog-js";

/**
 * Supabase's email OTP length is a per-project setting (Authentication ->
 * Providers -> Email -> Email OTP Length), not a fixed 6. Accept the whole
 * supported range so a project configured for 7-10 digits still works — a
 * shorter maxLength would truncate the pasted code and fail every sign-in.
 */
const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 10;

/**
 * Two-step email sign-in, code-first.
 *
 * The emailed code is the PRIMARY method because it is immune to the two things
 * that actually broke sign-in in practice:
 *  - link scanners / browser preloads consuming a single-use link before the
 *    human clicks it (the first /verify succeeds, the real click 403s), and
 *  - opening the link in a different browser from the one that requested it,
 *    where the PKCE code_verifier cookie doesn't exist.
 * A typed code has no URL to prefetch and no cookie to lose, so it works from
 * any device or browser. The emailed link stays as a secondary convenience.
 */
export function LoginForm({
  initialError,
  next,
  errorReason,
  errorDetail,
}: {
  initialError: string | null;
  next: string | null;
  /** Classified failure code from auth/callback, for analytics. */
  errorReason?: string;
  /** Raw provider/SDK message, shown only behind a disclosure. */
  errorDetail?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [status, setStatus] = useState<"idle" | "sending" | "verifying">("idle");
  const [error, setError] = useState<string | null>(initialError);
  const [detail, setDetail] = useState<string | undefined>(errorDetail);
  const [resent, setResent] = useState(false);

  // Report a failed emailed-link attempt once, with the real message, so remote
  // debugging doesn't depend on the user screenshotting the page.
  useEffect(() => {
    if (!errorReason) return;
    posthog.capture("magic_link_failed", { reason: errorReason, detail: errorDetail ?? null });
  }, [errorReason, errorDetail]);

  function clearError() {
    setError(null);
    setDetail(undefined);
  }

  async function sendCode(targetEmail: string, isResend: boolean) {
    const supabase = createClient();
    // Still pass emailRedirectTo so the secondary link in the email works; the
    // code and the link are two ways to redeem the same one-time token.
    const callback = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { emailRedirectTo: callback },
    });
    if (signInError) {
      setError(signInError.message);
      return false;
    }
    posthog.capture(isResend ? "signin_code_resent" : "signin_code_requested");
    return true;
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    clearError();

    const ok = await sendCode(email, false);
    setStatus("idle");
    if (ok) setStep("code");
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("verifying");
    clearError();

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    if (verifyError) {
      setStatus("idle");
      setError(
        /expired|invalid|not found/i.test(verifyError.message)
          ? "That code is incorrect or has expired. Check the latest email, or send a new code."
          : verifyError.message,
      );
      setDetail(`verifyOtp: ${verifyError.message}`);
      posthog.capture("signin_code_failed", { detail: verifyError.message });
      return;
    }

    posthog.capture("signin_code_verified");
    // refresh() so server components pick up the session cookie just written.
    router.push(next ?? "/projects");
    router.refresh();
  }

  async function handleResend() {
    setStatus("sending");
    clearError();
    const ok = await sendCode(email, true);
    setStatus("idle");
    if (ok) {
      setResent(true);
      setCode("");
    }
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{error}</p>
          {detail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs opacity-70">Technical details</summary>
              <p className="mt-1 break-words font-mono text-[11px] opacity-80">{detail}</p>
            </details>
          )}
        </div>
      )}

      {step === "email" ? (
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoComplete="email"
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
            {status === "sending" ? "Sending..." : "Email me a sign-in code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
          <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p>
              We sent a sign-in code to <span className="font-medium">{email}</span>
              {resent && " again"}.
            </p>
            <p className="mt-1 text-emerald-700">
              Enter it below — this works on any device or browser. The email also has a sign-in link if you
              prefer.
            </p>
          </div>

          {/* Supabase's OTP length is a project setting (6-10 digits), so never
              hard-code it: a maxLength shorter than the real code silently
              truncates it and every sign-in fails with "token is invalid". */}
          <input
            type="text"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`\\d{${CODE_MIN_LENGTH},${CODE_MAX_LENGTH}}`}
            maxLength={CODE_MAX_LENGTH}
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_MAX_LENGTH))}
            placeholder="Enter the code"
            aria-label="Sign-in code from your email"
            className="rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-[0.3em]"
          />

          <button
            type="submit"
            disabled={status === "verifying" || code.length < CODE_MIN_LENGTH}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "verifying" ? "Verifying..." : "Sign in"}
          </button>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setResent(false);
                clearError();
              }}
              className="hover:text-slate-700"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={status === "sending"}
              className="hover:text-slate-700 disabled:opacity-50"
            >
              {status === "sending" ? "Sending..." : "Send a new code"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
