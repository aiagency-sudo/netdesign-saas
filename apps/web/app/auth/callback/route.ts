import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/projects";

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const posthog = getPostHogClient();
      if (posthog && data.user) {
        posthog.identify({ distinctId: data.user.id, properties: { email: data.user.email } });
        posthog.capture({ distinctId: data.user.id, event: "user_signed_in" });
        await posthog.flush();
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
