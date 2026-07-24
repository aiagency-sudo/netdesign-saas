import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";

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

  const vsdxUrl = process.env["VSDX_SERVICE_URL"];
  if (!vsdxUrl) {
    return NextResponse.json({ error: "VSDX_SERVICE_URL is not configured on the server." }, { status: 503 });
  }

  let vsdxResponse: Response;
  try {
    vsdxResponse = await fetch(`${vsdxUrl.replace(/\/$/, "")}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project.design_json),
    });
  } catch (cause) {
    return NextResponse.json(
      { error: `Could not reach the vsdx export service: ${(cause as Error).message}` },
      { status: 502 },
    );
  }

  if (!vsdxResponse.ok) {
    const detail = await vsdxResponse.text();
    return NextResponse.json({ error: `vsdx service returned ${vsdxResponse.status}: ${detail}` }, { status: 502 });
  }

  const bytes = await vsdxResponse.arrayBuffer();

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/vnd.ms-visio.drawing",
      "Content-Disposition": `attachment; filename="${slugify(project.name)}.vsdx"`,
    },
  });
}
