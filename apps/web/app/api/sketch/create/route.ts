import { NextResponse } from "next/server";
import { z } from "zod";
import { composeDesignFromSketch } from "@netdesign/llm-extraction";
import { DesignValidationError, designParamsSchema, findingSchema } from "@netdesign/schema";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

const requestSchema = z.object({
  params: designParamsSchema,
  confidence: z.enum(["high", "medium", "low"]),
  observations: z.array(z.string()).default([]),
  recommendations: z.array(findingSchema).default([]),
  ingestNotes: z.array(z.string()).default([]),
  fileManifest: z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative() })).default([]),
});

/**
 * Step TWO of sketch import: the engineer has seen what was read and confirmed
 * it, so compose and save.
 *
 * The reading comes back from the client, so it is re-validated here against
 * the same schemas the reader produced it with — a client can edit the design
 * it is about to create (that's the point of the review step), but it cannot
 * put anything through the engine that isn't valid design-params.
 *
 * No Claude call happens here, so this step isn't metered; /api/sketch/read
 * already charged for the read.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const { params, confidence, observations, recommendations, ingestNotes, fileManifest } = parsedBody.data;

  try {
    // Recommendations are returned untouched — the design is what was drawn.
    const { design, recommendations: advisory } = composeDesignFromSketch(
      { params, confidence, observations, recommendations },
      ingestNotes,
    );

    const fileNames = fileManifest.map((file) => file.name).join(", ");
    const summary = `Imported from ${fileManifest.length || "uploaded"} diagram file${fileManifest.length === 1 ? "" : "s"}${fileNames ? `: ${fileNames}` : ""}`;

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        owner_id: user.id,
        name: design.meta.name,
        prompt: summary,
        design_json: design,
        source_kind: "sketch-import",
        // The manifest, not the bytes: diagram files belong in object storage,
        // which is a follow-up. This still records exactly what it was built from.
        source_configs: fileManifest,
        findings: advisory,
      })
      .select("id")
      .single();

    if (error || !project) {
      return NextResponse.json({ error: error?.message ?? "Could not save the imported design." }, { status: 500 });
    }

    const { data: version } = await supabase
      .from("project_versions")
      .insert({ project_id: project.id, design_json: design, prompt: summary, findings: advisory })
      .select("id")
      .single();

    if (version) {
      await supabase.from("projects").update({ current_version_id: version.id }).eq("id", project.id);
    }

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.id,
        event: "sketch_imported",
        properties: {
          project_id: project.id,
          confidence,
          device_count: design.devices.length,
          recommendation_count: advisory.length,
          file_count: fileManifest.length,
        },
      });
      await posthog.flush();
    }

    return NextResponse.json({ projectId: project.id, recommendationCount: advisory.length });
  } catch (err) {
    if (err instanceof DesignValidationError) {
      return NextResponse.json(
        { error: `That diagram produced a design that failed validation: ${err.message}` },
        { status: 422 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Could not create a design from that diagram." }, { status: 500 });
  }
}
