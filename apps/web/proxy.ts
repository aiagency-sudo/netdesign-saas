import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `ingest` is the PostHog reverse-proxy path (see next.config.ts rewrites) --
  // it's unauthenticated infra, not a page, and must never hit the signed-in
  // gate below or PostHog's own bootstrap/capture calls get redirected to
  // /login instead of proxied, breaking analytics for anyone not yet signed in.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
