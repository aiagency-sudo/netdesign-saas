import { describe, expect, it } from "vitest";
import { CLARIFY_TOOL_NAME, SYSTEM_PROMPT, TOOL_NAME, clarifyToolInputSchema, toolInputSchema } from "../src/prompt.js";

describe("extraction prompt", () => {
  it("embeds exactly 5 few-shot examples", () => {
    const matches = SYSTEM_PROMPT.match(/Example \d+:/g) ?? [];
    expect(matches).toHaveLength(5);
  });

  it("instructs the model to surface unmodeled requirements as a visible 'Not yet modeled:' assumption", () => {
    expect(SYSTEM_PROMPT).toContain("Not yet modeled:");
    // and demonstrates it with the MPLS few-shot example
    expect(SYSTEM_PROMPT).toContain("MPLS");
  });

  it("mentions the tool name so the model knows what to call", () => {
    expect(SYSTEM_PROMPT).toContain(TOOL_NAME);
  });

  it("mentions the clarifying-questions tool and when to prefer it", () => {
    expect(SYSTEM_PROMPT).toContain(CLARIFY_TOOL_NAME);
  });

  it("derives the clarify tool input schema from clarifyingQuestionsSchema (array of 1-3 strings)", () => {
    expect(clarifyToolInputSchema["type"]).toBe("object");
    expect(clarifyToolInputSchema).not.toHaveProperty("$schema");
    const properties = clarifyToolInputSchema["properties"] as Record<
      string,
      { type?: string; minItems?: number; maxItems?: number }
    >;
    expect(properties["questions"]!.type).toBe("array");
    expect(properties["questions"]!.minItems).toBe(1);
    expect(properties["questions"]!.maxItems).toBe(3);
  });

  it("derives the tool input schema from designParamsSchema (object, with required fields, no $schema wrapper)", () => {
    expect(toolInputSchema["type"]).toBe("object");
    expect(toolInputSchema).not.toHaveProperty("$schema");
    const required = toolInputSchema["required"] as string[];
    expect(new Set(required)).toEqual(
      new Set(["designPattern", "siteName", "intentSummary", "router", "accessSwitch", "firewall", "vlans"]),
    );
  });

  it("exposes the optional campus-only blocks the composer understands", () => {
    const properties = toolInputSchema["properties"] as Record<string, unknown>;
    for (const optional of ["coreSwitch", "distributionSwitch", "wirelessController"]) {
      expect(properties).toHaveProperty(optional);
    }
    // Optional: a flat design must not be forced to declare them.
    expect(toolInputSchema["required"]).not.toContain("wirelessController");
  });

  it("restricts designPattern to the patterns the composer supports", () => {
    const properties = toolInputSchema["properties"] as Record<string, { enum?: string[] }>;
    expect(new Set(properties["designPattern"]!.enum)).toEqual(
      new Set(["branch-office", "smb-flat", "campus-three-tier"]),
    );
  });
});
