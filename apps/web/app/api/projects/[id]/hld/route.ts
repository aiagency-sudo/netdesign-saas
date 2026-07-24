import { NextResponse } from "next/server";
import { generateHldDocx } from "@netdesign/doc-gen";
import { createClient } from "@/lib/supabase/server";

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

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${slugify(project.name)}-hld.docx"`,
    },
  });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design"
  );
}
