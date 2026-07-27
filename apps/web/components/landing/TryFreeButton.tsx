"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";

/**
 * Landing-page CTA. Captures the click (so the PostHog funnel is landing view
 * -> CTA click -> sign-in -> first design) then routes into the real sign-in
 * flow, asking the auth callback to land the user straight on the "new design"
 * page so activation is one step away.
 *
 * `variant`: "primary" is the scarce Cursor-Orange conversion button; "ink" is
 * the dark editorial button; "text" is an inline link.
 */
export function TryFreeButton({
  location,
  variant = "primary",
  children,
}: {
  location: string;
  variant?: "primary" | "ink" | "text";
  children: React.ReactNode;
}) {
  const router = useRouter();

  function handleClick() {
    posthog.capture("landing_cta_clicked", { location });
    router.push("/login?next=/projects/new");
  }

  const base = "inline-flex items-center justify-center text-sm font-medium transition-colors";
  const styles: Record<string, string> = {
    primary: "rounded-lg bg-[#f54e00] px-5 py-2.5 text-white hover:bg-[#d04200]",
    ink: "rounded-lg bg-[#26251e] px-5 py-2.5 text-[#f7f7f4] hover:bg-black",
    text: "font-medium text-[#f54e00] underline underline-offset-4 hover:text-[#d04200]",
  };

  return (
    <button type="button" onClick={handleClick} className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}
