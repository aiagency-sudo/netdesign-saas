import { NextResponse } from "next/server";
import { z } from "zod";
import { UnsupportedConfigError, importConfigs } from "@netdesign/config-parse";
import { DesignValidationError } from "@netdesign/schema";
import { checkGenerationRateLimit, recordGenerationEvent } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

/** Guard against someone pasting a whole config archive into one request. */
const MAX_FILES = 25;
const MAX_TOTAL_CHARS = 2_000_000;

const requestSchema = z.object({
  siteName: z.string().min(1).max(120).optional(),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        text: z.string().min(1),
      }),
    )
    .min(1, "Upload at least one configuration file.")
    .max(MAX_FILES, `Upload at most ${MAX_FILES} files at a time.`),
});

/**
 * Config-to-design import: uploaded device configs -> documentation.
 *
 * This route NEVER generates configuration. It stores the uploaded text
 * verbatim (`source_configs`) alongside the derived design and the advisory
 * findings, because the client's configuration is the source of truth for an
 * imported project — see packages/config-parse.
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

  const { files, siteName } = parsedBody.data;
  const totalChars = files.reduce((sum, file) => sum + file.text.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: "Those configurations are too large to import in one go." }, { status: 413 });
  }

  // Importing is cheap (no LLM call) but still creates a project, so it shares
  // the generation rate limit rather than offering an unmetered side door.
  const rateLimit = await checkGenerationRateLimit(supabase, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `You've reached the limit of ${rateLimit.limit} generations per hour. Try again later.` },
      { status: 429 },
    );
  }

  try {
    await recordGenerationEvent(supabase, user.id);

    const { design, findings } = importConfigs(files, ...(siteName ? [{ siteName }] : []));

    const importSummary = `Imported from ${files.length} configuration file${files.length === 1 ? "" : "s"}: ${files
      .map((file) => file.name)
      .join(", ")}`;

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        owner_id: user.id,
        name: design.meta.name,
        prompt: importSummary,
        design_json: design,
        source_kind: "config-import",
        source_configs: files,
        findings,
      })
      .select("id")
      .single();

    if (error || !project) {
      return NextResponse.json({ error: error?.message ?? "Could not save the imported project." }, { status: 500 });
    }

    const { data: version } = await supabase
      .from("project_versions")
      .insert({ project_id: project.id, design_json: design, prompt: importSummary, findings })
      .select("id")
      .single();

    if (version) {
      await supabase.from("projects").update({ current_version_id: version.id }).eq("id", project.id);
    }

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.id,
        event: "design_imported",
        properties: {
          project_id: project.id,
          file_count: files.length,
          device_count: design.devices.length,
          finding_count: findings.length,
          finding_codes: [...new Set(findings.map((finding) => finding.code))],
        },
      });
      await posthog.flush();
    }

    return NextResponse.json({ projectId: project.id, findingCount: findings.length });
  } catch (err) {
    if (err instanceof UnsupportedConfigError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof DesignValidationError) {
      return NextResponse.json(
        { error: `The uploaded configuration produced a design that failed validation: ${err.message}` },
        { status: 422 },
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Could not import those configurations." }, { status: 500 });
  }
}
