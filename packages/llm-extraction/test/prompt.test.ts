import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, TOOL_NAME, toolInputSchema } from "../src/prompt.js";

describe("extraction prompt", () => {
  it("embeds exactly 3 few-shot examples", () => {
    const matches = SYSTEM_PROMPT.match(/Example \d+:/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("mentions the tool name so the model knows what to call", () => {
    expect(SYSTEM_PROMPT).toContain(TOOL_NAME);
  });

  it("derives the tool input schema from designParamsSchema (object, with required fields, no $schema wrapper)", () => {
    expect(toolInputSchema["type"]).toBe("object");
    expect(toolInputSchema).not.toHaveProperty("$schema");
    const required = toolInputSchema["required"] as string[];
    expect(new Set(required)).toEqual(
      new Set(["designPattern", "siteName", "intentSummary", "router", "accessSwitch", "firewall", "vlans"]),
    );
  });

  it("restricts designPattern to the patterns the composer supports", () => {
    const properties = toolInputSchema["properties"] as Record<string, { enum?: string[] }>;
    expect(new Set(properties["designPattern"]!.enum)).toEqual(new Set(["branch-office", "smb-flat"]));
  });
});
