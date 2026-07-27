import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  source: z.string().max(80).optional(),
});

/** Public (unauthenticated) landing-page waitlist capture — see supabase/migrations/0004_waitlist.sql. */
export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waitlist")
    .insert({ email: parsed.data.email, source: parsed.data.source ?? "landing" });

  // 23505 = unique violation: they're already on the list, which is a success
  // from the visitor's point of view, not an error to surface.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Could not join the waitlist. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
