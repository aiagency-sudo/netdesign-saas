import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

/** Email OTP types Supabase can send us on a magic-link/confirmation URL. Anything else is rejected rather than cast. */
const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["magiclink", "signup", "invite", "recovery", "email_change", "email"]);

function toEmailOtpType(value: string | null): EmailOtpType | null {
  return value && EMAIL_OTP_TYPES.has(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

/**
 * Classifies an auth failure into a reason the login page can explain to the
 * user. The two failures that actually strand people are a consumed/expired
 * link and a PKCE code-verifier mismatch (the link was opened in a different
 * browser than the one that requested it — e.g. requested on desktop, opened
 * in a phone's mail app in-app browser).
 */
function classifyAuthError(message: string): "expired" | "browser" | "auth" {
  const m = message.toLowerCase();
  if (m.includes("expired") || m.includes("already used") || m.includes("not found")) return "expired";
  if (m.includes("verifier") || m.includes("challenge") || m.includes("pkce")) return "browser";
  return "auth";
}

/**
 * Completes magic-link sign-in. Supports BOTH shapes a Supabase email link can
 * arrive as, so a link works regardless of where it's opened:
 *
 *  - `?code=...`       PKCE. Requires the code_verifier cookie set when the link
 *                      was requested, so it only works in the SAME browser.
 *  - `?token_hash=...&type=...`  Browser-independent OTP verification — this is
 *                      what makes links clicked in a mail app's in-app browser,
 *                      or on a different device, work at all.
 *
 * Previously only `?code=` was handled, so any cross-browser click fell through
 * to a bare redirect back to /login with no explanation. Failures now carry a
 * `?error=<reason>` the login page renders as human-readable text.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? "/projects";
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = toEmailOtpType(searchParams.get("type"));

  // Supabase can redirect here with its own error (e.g. otp_expired) instead of a credential.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  /**
   * Carries a short technical `detail` through the redirect alongside the
   * friendly reason. Shown only behind a "Technical details" disclosure and
   * sent to PostHog — without it, every auth failure looks identical from the
   * outside and can only be debugged by guesswork.
   */
  const failure = (reason: string, detail?: string) => {
    const params = new URLSearchParams({ error: reason });
    if (detail) params.set("detail", detail.slice(0, 200));
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  };

  if (providerError) {
    return failure(classifyAuthError(providerError), providerError);
  }

  if (!code && !tokenHash) {
    // Distinguishes "no params at all" from "the template sent an empty value".
    const present = [...searchParams.keys()].join(",") || "none";
    return failure("invalid", `no credential in callback; params present: ${present}`);
  }

  const supabase = await createClient();

  // token_hash first: it's browser-independent, so when a link carries both we
  // prefer the path that can't fail on a missing code_verifier cookie.
  const { data, error } = tokenHash && otpType
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
    : await supabase.auth.exchangeCodeForSession(code!); // one of the two is non-null (checked above)

  if (error) {
    const method = tokenHash && otpType ? "verifyOtp" : "exchangeCodeForSession";
    return failure(classifyAuthError(error.message), `${method}: ${error.message}`);
  }

  const posthog = getPostHogClient();
  if (posthog && data.user) {
    posthog.identify({ distinctId: data.user.id, properties: { email: data.user.email } });
    posthog.capture({ distinctId: data.user.id, event: "user_signed_in" });
    await posthog.flush();
  }

  return NextResponse.redirect(`${origin}${next}`);
}
