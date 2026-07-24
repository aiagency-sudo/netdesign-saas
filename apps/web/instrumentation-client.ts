import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!token) {
  // A missing token is expected in local dev (it's not in .env.example as
  // required, and every session doesn't need it) -- warn instead of
  // throwing, since a thrown error here crashes every page's client bundle.
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is not set -- PostHog analytics are disabled for this session.",
    );
  }
} else {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
    // None of this app's dashboards use session replay, and the design
    // pages render real customer network data (IPs, topology, device
    // names) as plain DOM content that autocapture's input-masking
    // wouldn't cover -- keep replay off rather than rely on project-level
    // settings someone could flip on later without knowing this context.
    disable_session_recording: true,
  });
}
