import { NextResponse } from "next/server";
import { combineConfigs, renderAllConfigs } from "@netdesign/config-gen";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("name, design_json")
    .eq("id", id)
    .single();

  if (error || !project || !project.design_json) {
    return NextResponse.json({ error: "Design not found." }, { status: 404 });
  }

  const configs = renderAllConfigs(project.design_json);
  const deviceIds = Object.keys(configs);

  if (deviceIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "No devices in this design have a supported vendor/role for config generation yet (cisco-ios routers and switches, plus fortinet-fortigate and paloalto-panos firewalls).",
      },
      { status: 422 },
    );
  }

  // Section headers use each device's own comment character (config-gen owns
  // that rule) — a `!` header is invalid pasted into a FortiGate or PAN-OS.
  const combined = combineConfigs(project.design_json, configs);

  const posthog = getPostHogClient();
  if (posthog) {
    posthog.capture({
      distinctId: user.id,
      event: "config_downloaded",
      properties: { project_id: id, device_count: deviceIds.length },
    });
    await posthog.flush();
  }

  return new NextResponse(combined, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slugify(project.name)}-configs.txt"`,
    },
  });
}
