"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Server routes capture events with distinctId: user.id (the Supabase UUID),
 * but client-side capture() calls (login page, new-project form, regenerate
 * form) run before anything ever tells posthog-js that's who's signed in --
 * they stay on the browser's anonymous distinct_id forever, which silently
 * splits every funnel that spans a client event and a server event (e.g.
 * design_generation_started -> design_generated) across two person profiles.
 * Mounted once in the root layout so it runs on every page.
 */
export function PostHogIdentify() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && posthog.get_distinct_id() !== user.id) {
        posthog.identify(user.id, { email: user.email });
      }
    });
  }, []);

  return null;
}
