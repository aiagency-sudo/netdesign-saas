import { designParamsSchema, type DesignParams } from "@netdesign/schema";
import type { ExtractionClient, ExtractionResponse } from "./client.js";
import {
  CLARIFY_TOOL_DESCRIPTION,
  CLARIFY_TOOL_NAME,
  clarifyToolInputSchema,
  clarifyingQuestionsSchema,
  SYSTEM_PROMPT,
  TOOL_DESCRIPTION,
  TOOL_NAME,
  toolInputSchema,
} from "./prompt.js";

export class DesignParamsExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignParamsExtractionError";
  }
}

/** Thrown when Claude decides the prose is too ambiguous to extract and asks for more detail instead. */
export class NeedsClarificationError extends Error {
  readonly questions: string[];

  constructor(questions: string[]) {
    super(`Claude needs more detail before it can extract a design:\n${questions.map((q) => `  - ${q}`).join("\n")}`);
    this.name = "NeedsClarificationError";
    this.questions = questions;
  }
}

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;

export interface ExtractDesignParamsOptions {
  client: ExtractionClient;
  model?: string;
}

/**
 * Calls Claude to turn free-form network requirements prose into schema-valid {@link DesignParams}.
 * Claude may instead call the clarifying-questions tool if the prose is too ambiguous to extract at
 * all, in which case this throws {@link NeedsClarificationError} rather than forcing a fabricated guess.
 */
export async function extractDesignParams(prose: string, options: ExtractDesignParamsOptions): Promise<DesignParams> {
  const { client, model = DEFAULT_MODEL } = options;

  const response = await client.createMessage({
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prose }],
    tools: [
      { name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: toolInputSchema },
      { name: CLARIFY_TOOL_NAME, description: CLARIFY_TOOL_DESCRIPTION, input_schema: clarifyToolInputSchema },
    ],
    toolChoice: { type: "any" },
    maxTokens: MAX_TOKENS,
  });

  return parseExtractionResponse(response);
}

/** Pure parsing/validation step, split out from {@link extractDesignParams} so it's testable without a client at all. */
export function parseExtractionResponse(response: ExtractionResponse): DesignParams {
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

  const toolUse = response.content.find((block) => block.type === "tool_use" && block.name === TOOL_NAME);
  if (!toolUse) {
    const seen = response.content.map((block) => block.type).join(", ") || "(none)";
    throw new DesignParamsExtractionError(`Claude did not call the "${TOOL_NAME}" tool. Got content blocks: ${seen}`);
  }

  const result = designParamsSchema.safeParse(toolUse.input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
    );
    throw new DesignParamsExtractionError(`Claude's extracted design-params failed validation:\n${lines.join("\n")}`);
  }

  return result.data;
}
