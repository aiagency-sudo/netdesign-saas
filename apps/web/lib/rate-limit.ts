import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT_PER_HOUR = 20;

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
}

/**
 * Rolling 1-hour window per user, counted from generation_events rather than
 * a decaying counter column, so "how many left" is always just a row count.
 * This is a flat abuse ceiling, not a paid-plan quota (no billing tiers
 * exist yet — CLAUDE.md says don't touch Stripe without founder review), so
 * it's configurable via an env var rather than stored per-user.
 */
export async function checkGenerationRateLimit(
  supabase: SupabaseClient<Database>,
  ownerId: string,
): Promise<RateLimitStatus> {
  const limit = Number(process.env["GENERATION_RATE_LIMIT_PER_HOUR"] ?? DEFAULT_LIMIT_PER_HOUR);
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count, error } = await supabase
    .from("generation_events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .gte("created_at", since);

  if (error) {
    throw new Error(`Could not check the generation rate limit: ${error.message}`);
  }

  return { allowed: (count ?? 0) < limit, limit };
}

/** Records one generation attempt (called before the Claude API call, so failed attempts still count against the limit). */
export async function recordGenerationEvent(supabase: SupabaseClient<Database>, ownerId: string): Promise<void> {
  const { error } = await supabase.from("generation_events").insert({ owner_id: ownerId });
  if (error) {
    throw new Error(`Could not record the generation attempt: ${error.message}`);
  }
}
