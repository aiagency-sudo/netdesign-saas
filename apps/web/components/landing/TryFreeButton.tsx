"use client";

import { useRouter } from "next/navigation";
import posthog from "posthog-js";

/**
 * Landing-page primary CTA. Captures the click (so the PostHog funnel is
 * landing view -> CTA click -> sign-in -> first design) then routes into the
 * real sign-in flow, asking the auth callback to land the user straight on
 * the "new design" page so activation is one step away.
 */
export function TryFreeButton({
  location,
  className,
  children,
}: {
  location: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  function handleClick() {
    posthog.capture("landing_cta_clicked", { location });
    router.push("/login?next=/projects/new");
  }

  return (
    <button type="button" onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
