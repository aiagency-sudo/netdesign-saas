import type { Design, DesignParams, Finding } from "@netdesign/schema";
import type { IngestedAsset } from "@netdesign/doc-ingest";
import { composeDesign } from "@netdesign/design-engine";
import type { ExtractionClient, ExtractionRequestBlock, ExtractionResponse } from "./client.js";
import { CLARIFY_TOOL_DESCRIPTION, CLARIFY_TOOL_NAME, clarifyToolInputSchema, clarifyingQuestionsSchema } from "./prompt.js";
import { DesignParamsExtractionError, NeedsClarificationError } from "./extract.js";
import {
  SKETCH_SYSTEM_PROMPT,
  SKETCH_TOOL_DESCRIPTION,
  SKETCH_TOOL_NAME,
  sketchExtractionSchema,
  sketchToolInputSchema,
  type SketchExtraction,
} from "./sketch-prompt.js";

const DEFAULT_MODEL = "claude-sonnet-5";
/** Larger than the prose budget: a diagram read yields observations and recommendations alongside the params. */
const MAX_TOKENS = 4096;

export interface SketchExtractionResult {
  /** What was drawn — faithful to the diagram, flaws included. */
  params: DesignParams;
  confidence: "high" | "medium" | "low";
  /** Plain-language record of what was read off the diagram, so the reading itself can be checked. */
  observations: string[];
  /** Corrections offered for the engineer to accept or reject. Never applied. */
  recommendations: Finding[];
}

export interface ExtractFromDiagramOptions {
  client: ExtractionClient;
  model?: string;
  /** Anything the user typed alongside the upload — site name, context, corrections to the drawing. */
  notes?: string;
}

/**
 * Reads an uploaded diagram into design-params plus recommended corrections.
 *
 * The output is deliberately split in two: `params` describes what the diagram
 * actually shows, and `recommendations` holds everything the model would
 * change. Nothing is silently improved — the engineer decides which
 * corrections to take, which is the founder's explicit rule for this feature.
 *
 * Throws {@link NeedsClarificationError} when the diagram is too ambiguous to
 * read, rather than returning a confident-looking guess.
 */
export async function extractDesignFromDiagram(
  assets: IngestedAsset[],
  options: ExtractFromDiagramOptions,
): Promise<SketchExtractionResult> {
  const { client, model = DEFAULT_MODEL } = options;

  if (assets.length === 0) {
    throw new DesignParamsExtractionError("No diagram content was provided to read.");
  }

  const response = await client.createMessage({
    model,
    system: SKETCH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildContent(assets, options.notes) }],
    tools: [
      { name: SKETCH_TOOL_NAME, description: SKETCH_TOOL_DESCRIPTION, input_schema: sketchToolInputSchema },
      { name: CLARIFY_TOOL_NAME, description: CLARIFY_TOOL_DESCRIPTION, input_schema: clarifyToolInputSchema },
    ],
    toolChoice: { type: "any" },
    maxTokens: MAX_TOKENS,
  });

  return parseSketchResponse(response);
}

/**
 * Builds the user turn: each asset labelled with its filename so the model can
 * refer to "page 2 of design.docx" in its observations, structured text inline,
 * images and PDFs as their own blocks.
 */
export function buildContent(assets: IngestedAsset[], notes?: string): ExtractionRequestBlock[] {
  const blocks: ExtractionRequestBlock[] = [];

  if (notes && notes.trim() !== "") {
    blocks.push({ type: "text", text: `Notes from the engineer who uploaded this:\n${notes.trim()}` });
  }

  for (const asset of assets) {
    blocks.push({ type: "text", text: `--- ${asset.label} ---` });
    if (asset.kind === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: asset.mediaType, data: asset.base64 } });
    } else if (asset.kind === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: asset.base64 } });
    } else {
      blocks.push({ type: "text", text: asset.text });
    }
  }

  blocks.push({
    type: "text",
    text: "Read this network diagram. Emit the design exactly as drawn, and put anything you would change in recommendations.",
  });

  return blocks;
}

/** Pure parsing/validation step, split out so it's testable without a client. */
export function parseSketchResponse(response: ExtractionResponse): SketchExtractionResult {
  const clarifyUse = response.content.find((block) => block.type === "tool_use" && block.name === CLARIFY_TOOL_NAME);
  if (clarifyUse) {
    const result = clarifyingQuestionsSchema.safeParse(clarifyUse.input);
    if (!result.success) {
      throw new DesignParamsExtractionError(
        `Claude called "${CLARIFY_TOOL_NAME}" but its questions failed validation: ${result.error.message}`,
      );
    }
    throw new NeedsClarificationError(result.data.questions);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === SKETCH_TOOL_NAME);
  if (!toolUse) {
    const seen = response.content.map((block) => block.type).join(", ") || "(none)";
    throw new DesignParamsExtractionError(`Claude did not call the "${SKETCH_TOOL_NAME}" tool. Got content blocks: ${seen}`);
  }

  const result = sketchExtractionSchema.safeParse(toolUse.input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
    );
    throw new DesignParamsExtractionError(`Claude's diagram reading failed validation:\n${lines.join("\n")}`);
  }

  return splitExtraction(result.data);
}

/**
 * Separates the design-params from the reading metadata. The extras are
 * stripped rather than passed on, so `composeDesign` keeps receiving exactly
 * the contract it already has.
 */
function splitExtraction(extraction: SketchExtraction): SketchExtractionResult {
  const { confidence, observations, recommendations, ...params } = extraction;
  return { params, confidence, observations, recommendations };
}

/**
 * Composes the design a diagram described, carrying the reading itself into
 * `meta.assumptions` — an engineer reviewing an imported sketch needs to see
 * what was read as much as what was built.
 *
 * Recommendations are returned alongside, never merged in: the composed design
 * is the diagram as drawn.
 */
export function composeDesignFromSketch(
  extraction: SketchExtractionResult,
  ingestNotes: string[] = [],
): { design: Design; recommendations: Finding[] } {
  const observationNotes = extraction.observations.map((observation) => `Read from the diagram: ${observation}`);
  const confidenceNote =
    extraction.confidence === "high"
      ? []
      : [
          `The diagram was read with ${extraction.confidence} confidence — check the "Read from the diagram" notes above before relying on this design.`,
        ];

  const design = composeDesign({
    ...extraction.params,
    assumptions: [...ingestNotes, ...observationNotes, ...confidenceNote, ...extraction.params.assumptions],
  });

  return { design, recommendations: extraction.recommendations };
}
