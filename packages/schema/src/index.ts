import type { z } from "zod";
import { designSchema } from "./zod/design.js";

export * from "./zod/enums.js";
export * from "./zod/primitives.js";
export * from "./zod/meta.js";
export * from "./zod/device.js";
export * from "./zod/link.js";
export * from "./zod/segment.js";
export * from "./zod/routing.js";
export * from "./zod/security.js";
export * from "./zod/cloud.js";
export * from "./zod/design.js";
export * from "./zod/design-params.js";

export { default as designSchemaJson } from "./design-schema.json" with { type: "json" };

/** Thrown by {@link parseDesign} with a human-readable, per-field breakdown. */
export class DesignValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(zodError: z.ZodError) {
    super(DesignValidationError.format(zodError));
    this.name = "DesignValidationError";
    this.issues = zodError.issues;
  }

  private static format(error: z.ZodError): string {
    const lines = error.issues.map(
      (issue) => `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
    );
    return `Design JSON failed schema validation:\n${lines.join("\n")}`;
  }
}

/** Parses and validates a design JSON payload, throwing {@link DesignValidationError} on failure. */
export function parseDesign(input: unknown): import("./zod/design.js").Design {
  const result = designSchema.safeParse(input);
  if (!result.success) {
    throw new DesignValidationError(result.error);
  }
  return result.data;
}

/** Non-throwing variant of {@link parseDesign}; inspect `.success` before using `.data`. */
export function safeParseDesign(input: unknown) {
  return designSchema.safeParse(input);
}
