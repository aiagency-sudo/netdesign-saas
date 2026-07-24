import type Anthropic from "@anthropic-ai/sdk";

/**
 * A narrow, DI-friendly slice of what the extraction module needs from
 * Claude — deliberately not the full `@anthropic-ai/sdk` surface, so tests
 * can supply a fake client with no SDK/network involved at all.
 */
export interface ExtractionMessageParams {
  model: string;
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  toolChoice: { type: "tool"; name: string } | { type: "any" };
  maxTokens: number;
}

export interface ExtractionContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

export interface ExtractionResponse {
  content: ExtractionContentBlock[];
}

export interface ExtractionClient {
  createMessage(params: ExtractionMessageParams): Promise<ExtractionResponse>;
}

/**
 * Builds a real client backed by `@anthropic-ai/sdk`. The SDK is imported
 * lazily so packages that only use fake clients in tests never need it
 * loaded, and so a missing ANTHROPIC_API_KEY only breaks the code path that
 * actually calls Claude.
 */
export function createAnthropicExtractionClient(options: { apiKey?: string } = {}): ExtractionClient {
  return {
    async createMessage(params: ExtractionMessageParams): Promise<ExtractionResponse> {
      const apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Pass { apiKey } to createAnthropicExtractionClient() or set the environment variable.",
        );
      }

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey });

      const message = await anthropic.messages.create({
        model: params.model,
        system: params.system,
        messages: params.messages,
        // params.tools' input_schema is a plain Record<string, unknown> (derived at runtime from
        // zodToJsonSchema); the SDK wants its own narrower InputSchema type, which is a structural
        // match at runtime, but not something worth threading a JSON Schema type through for.
        tools: params.tools as unknown as Anthropic.Tool[],
        tool_choice: params.toolChoice,
        max_tokens: params.maxTokens,
      });

      return { content: message.content as ExtractionContentBlock[] };
    },
  };
}
