import { NextResponse } from "next/server";
import { UnsupportedUploadError, ingestUploads, type UploadedFile } from "@netdesign/doc-ingest";
import { NeedsClarificationError, createAnthropicExtractionClient, extractDesignFromDiagram } from "@netdesign/llm-extraction";
import { checkGenerationRateLimit, recordGenerationEvent } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getPostHogClient } from "@/lib/posthog-server";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/**
 * Step ONE of sketch import: read the uploaded diagram and hand the reading
 * back. Deliberately saves nothing.
 *
 * A diagram is lossy input, so the engineer confirms the reading before a
 * project exists — see /api/sketch/create for step two. That split is the
 * whole point: a misread topology that looks finished is worse than a
 * question, so nothing is committed until a human has seen what was read.
 *
 * This is the metered step, because this is the one that calls Claude.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the diagram as multipart form data." }, { status: 400 });
  }

  const uploads = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (uploads.length === 0) {
    return NextResponse.json({ error: "Add at least one diagram file." }, { status: 400 });
  }
  if (uploads.length > MAX_FILES) {
    return NextResponse.json({ error: `Upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
  }

  const totalBytes = uploads.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "Those files are too large to read in one go." }, { status: 413 });
  }

  const rateLimit = await checkGenerationRateLimit(supabase, user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: `You've reached the limit of ${rateLimit.limit} generations per hour. Try again later.` },
      { status: 429 },
    );
  }

  const notes = form.get("notes");
  const files: UploadedFile[] = await Promise.all(
    uploads.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );

  try {
    const ingested = ingestUploads(files);
    await recordGenerationEvent(supabase, user.id);

    const reading = await extractDesignFromDiagram(ingested.assets, {
      client: createAnthropicExtractionClient(),
      ...(typeof notes === "string" && notes.trim() ? { notes: notes.trim() } : {}),
    });

    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: user.id,
        event: "sketch_read",
        properties: {
          file_count: files.length,
          confidence: reading.confidence,
          recommendation_count: reading.recommendations.length,
          recommendation_codes: [...new Set(reading.recommendations.map((item) => item.code))],
          design_pattern: reading.params.designPattern,
        },
      });
      await posthog.flush();
    }

    return NextResponse.json({
      params: reading.params,
      confidence: reading.confidence,
      observations: reading.observations,
      recommendations: reading.recommendations,
      ingestNotes: ingested.notes,
      fileManifest: files.map((file) => ({ name: file.name, bytes: file.bytes.byteLength })),
    });
  } catch (err) {
    if (err instanceof UnsupportedUploadError) {
      return NextResponse.json({ error: err.message }, { status: 415 });
    }
    if (err instanceof NeedsClarificationError) {
      // Same shape the prose path returns, so the UI's existing
      // clarifying-questions handling works unchanged.
      return NextResponse.json({ needsClarification: true, questions: err.questions }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not read that diagram." }, { status: 500 });
  }
}
