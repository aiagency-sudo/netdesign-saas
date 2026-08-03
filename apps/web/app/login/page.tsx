import { LoginForm } from "./login-form";

/**
 * Human-readable text for the `?error=` reasons auth/callback redirects with.
 * Without this the callback's failure was invisible — the user just saw a
 * pristine form again and assumed nothing had happened, which is what made a
 * failed magic link look like an endless loop.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  expired:
    "That sign-in link has expired or was already used. Links are single-use — request a fresh one below.",
  browser:
    "That link was opened in a different browser than the one that requested it. Request a new link below and open it in this browser.",
  invalid: "That sign-in link was incomplete. Request a new one below.",
  auth: "We couldn't complete sign-in with that link. Request a new one below.",
};

/** Reads `?error=` / `?next=` server-side, so the client form needs no window access and no Suspense boundary. */
function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reason = first(params["error"]);
  const initialError = reason ? (CALLBACK_ERRORS[reason] ?? CALLBACK_ERRORS["auth"]!) : null;
  const detail = first(params["detail"]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-2 text-2xl font-semibold">NetDesign.app</h1>
      <p className="mb-6 text-sm text-slate-500">
        We&apos;ll email you a 6-digit sign-in code — no password needed.
      </p>
      <LoginForm
        initialError={initialError}
        next={first(params["next"])}
        {...(reason ? { errorReason: reason } : {})}
        {...(detail ? { errorDetail: detail } : {})}
      />
    </main>
  );
}
