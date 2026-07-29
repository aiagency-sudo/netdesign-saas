import type { PostHog } from "posthog-node";
import type { Design } from "@netdesign/schema";

/**
 * Marker the extractor prepends to any requirement it understood but the
 * current design-params can't represent (WAN/MPLS, DC links, QoS, wireless,
 * etc. — see llm-extraction's SYSTEM_PROMPT). Kept in one place so the
 * analytics tally and the prompt convention can't drift apart.
 */
export const UNMODELED_PREFIX = "Not yet modeled:";

/**
 * The requirements a design acknowledged but didn't model, pulled from
 * `meta.assumptions` — the text after the "Not yet modeled:" marker, trimmed.
 * Empty when the design covered everything the user asked for.
 */
export function unmodeledRequirements(design: Design): string[] {
  return (design.meta.assumptions ?? [])
    .filter((a) => a.startsWith(UNMODELED_PREFIX))
    .map((a) => a.slice(UNMODELED_PREFIX.length).trim())
    .filter((a) => a.length > 0);
}

/**
 * Emits one `design_unmodeled_requirement` event per unmodeled requirement so
 * PostHog can rank which out-of-scope requests come up most (a data-driven
 * build queue). No-op when the design modeled everything. Returns the list so
 * the caller can also attach a count to its main generation event.
 */
export function captureUnmodeledRequirements(
  posthog: PostHog,
  args: { distinctId: string; projectId: string; source: "generate" | "regenerate" },
  design: Design,
): string[] {
  const requirements = unmodeledRequirements(design);
  for (const requirement of requirements) {
    posthog.capture({
      distinctId: args.distinctId,
      event: "design_unmodeled_requirement",
      properties: { project_id: args.projectId, source: args.source, requirement },
    });
  }
  return requirements;
}
