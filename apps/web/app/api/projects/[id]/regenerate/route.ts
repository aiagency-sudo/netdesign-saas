import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DesignParamsExtractionError,
  NeedsClarificationError,
  createAnthropicExtractionClient,
  generateBranchOfficeDesign,
} from "@netdesign/llm-extraction";
import { DesignValidationError } from "@netdesign/schema";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

const requestSchema = z.object({
  prompt: z.string().min(1, "Describe the network you need."),
});

/** Re-runs the pipeline for an existing project and appends the result as a new version, rather than creating a new project. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!process.env["ANTHROPIC_API_KEY"]) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not configured on the server." }, { status: 503 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { data: existingProject } = await supabase.from("projects").select("id").eq("id", id).single();
  if (!existingProject) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const client = createAnthropicExtractionClient();
    const design = await generateBranchOfficeDesign(parsedBody.data.prompt, { client });

    const { data: version, error: versionError } = await supabase
      .from("project_versions")
      .insert({ project_id: id, design_json: design, prompt: parsedBody.data.prompt })
      .select("id")
      .single();

    if (versionError || !version) {
      return NextResponse.json({ error: versionError?.message ?? "Could not save the new version." }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        name: design.meta.name,
        prompt: parsedBody.data.prompt,
        design_json: design,
        current_version_id: version.id,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.id,
        event: "design_regenerated",
        properties: {
          project_id: id,
          version_id: version.id,
          design_name: design.meta.name,
          device_count: design.devices?.length ?? 0,
        },
      });
      await posthog.flush();
    }

    return NextResponse.json({ versionId: version.id, design });
  } catch (err) {
    if (err instanceof NeedsClarificationError) {
      return NextResponse.json({ needsClarification: true, questions: err.questions }, { status: 422 });
    }
    if (err instanceof DesignParamsExtractionError || err instanceof DesignValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "Design generation failed unexpectedly." }, { status: 500 });
  }
}
