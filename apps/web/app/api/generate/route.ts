import { NextResponse } from "next/server";
import { z } from "zod";
import {
  DesignParamsExtractionError,
  createAnthropicExtractionClient,
  generateBranchOfficeDesign,
} from "@netdesign/llm-extraction";
import { DesignValidationError } from "@netdesign/schema";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

const requestSchema = z.object({
  prompt: z.string().min(1, "Describe the network you need."),
});

export async function POST(request: Request) {
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

  try {
    const client = createAnthropicExtractionClient();
    const design = await generateBranchOfficeDesign(parsedBody.data.prompt, { client });

    const { data: project, error } = await supabase
      .from("projects")
      .insert({ owner_id: user.id, name: design.meta.name, prompt: parsedBody.data.prompt, design_json: design })
      .select("id")
      .single();

    if (error || !project) {
      return NextResponse.json({ error: error?.message ?? "Could not save the project." }, { status: 500 });
    }

    // Every project's history starts with itself as version 1. Not
    // transactional with the insert above — an interruption here leaves the
    // project without a version row/current_version_id, which is a minor
    // history gap, not a broken project (design_json above already has the
    // design; the page renders off that regardless of versioning state).
    const { data: version } = await supabase
      .from("project_versions")
      .insert({ project_id: project.id, design_json: design, prompt: parsedBody.data.prompt })
      .select("id")
      .single();

    if (version) {
      await supabase.from("projects").update({ current_version_id: version.id }).eq("id", project.id);
    }

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.id,
        event: "design_generated",
        properties: {
          project_id: project.id,
          design_name: design.meta.name,
          device_count: design.devices?.length ?? 0,
        },
      });
      await posthog.flush();
    }

    return NextResponse.json({ projectId: project.id, design });
  } catch (err) {
    if (err instanceof DesignParamsExtractionError || err instanceof DesignValidationError) {
      const posthog = getPostHogClient();
      if (posthog) {
        posthog.capture({
          distinctId: user.id,
          event: "design_generation_failed",
          properties: { error_type: err instanceof DesignParamsExtractionError ? "extraction" : "validation" },
        });
        await posthog.flush();
      }
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "Design generation failed unexpectedly." }, { status: 500 });
  }
}
