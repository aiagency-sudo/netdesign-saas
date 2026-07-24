import { NextResponse } from "next/server";
import { generateHldDocx } from "@netdesign/doc-gen";
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

  const buffer = await generateHldDocx(project.design_json);

  const posthog = getPostHogClient();
  if (posthog) {
    posthog.capture({ distinctId: user.id, event: "hld_downloaded", properties: { project_id: id } });
    await posthog.flush();
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${slugify(project.name)}-hld.docx"`,
    },
  });
}
