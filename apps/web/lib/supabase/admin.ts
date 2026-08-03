import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * SERVER-ONLY Supabase client using the service_role key, which bypasses RLS.
 *
 * Needed because `public.waitlist` deliberately has no SELECT policy (see
 * 0004_waitlist.sql) — anon/authenticated can insert but never read the list
 * back — and because listing auth users requires the admin API.
 *
 * NEVER import this from a Client Component or anything reachable by the
 * browser: the service_role key is a full-access secret. It is only read from
 * `SUPABASE_SERVICE_ROLE_KEY` (no NEXT_PUBLIC_ prefix, so Next will not inline
 * it into a client bundle). Returns null when unset so the admin page can
 * degrade gracefully in local dev instead of crashing the app.
 */
export function createAdminClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !serviceRoleKey) {
    return null;
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
