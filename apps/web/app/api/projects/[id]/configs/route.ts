import { NextResponse } from "next/server";
import { renderAllConfigs } from "@netdesign/config-gen";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";
import { getPostHogClient } from "@/lib/posthog-server";

const SECTION_RULE = "!".padEnd(60, "=");

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
          "No devices in this design have a supported vendor/role for config generation yet (only cisco-ios routers and access switches today).",
      },
      { status: 422 },
    );
  }

  const combined = deviceIds
    .map((deviceId) => `${SECTION_RULE}\n! Device: ${deviceId}\n${SECTION_RULE}\n\n${configs[deviceId]}`)
    .join("\n\n");

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
