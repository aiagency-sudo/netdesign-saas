/** Reads and validates the Supabase env vars shared by the browser/server/middleware clients. */
export function supabaseEnv(): { url: string; anonKey: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set — see .env.example.",
    );
  }
  return { url, anonKey };
}
