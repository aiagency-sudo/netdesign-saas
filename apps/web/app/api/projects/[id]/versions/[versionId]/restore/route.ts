import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Makes an older version the project's current one — does not delete or mutate any version row, just repoints projects.design_json/current_version_id. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const { data: version, error: versionError } = await supabase
    .from("project_versions")
    .select("id, project_id, design_json, prompt")
    .eq("id", versionId)
    .eq("project_id", id)
    .single();

  if (versionError || !version) {
    return NextResponse.json({ error: "Version not found." }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      name: version.design_json.meta.name,
      prompt: version.prompt,
      design_json: version.design_json,
      current_version_id: version.id,
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
