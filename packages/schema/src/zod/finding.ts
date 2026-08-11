import { z } from "zod";

/**
 * An advisory observation about a design or the material it came from.
 *
 * Findings are REPORTING ONLY. They never mutate a design, never contain
 * generated configuration, and are never applied automatically — the engineer
 * reads them and decides. Two producers share this shape:
 *  - `packages/config-parse` — what looks wrong in an uploaded configuration.
 *  - `packages/llm-extraction` — corrections recommended for an uploaded
 *    sketch or diagram (the design itself still reflects what was drawn).
 *
 * It lives in the schema package because it crosses module boundaries and is
 * persisted alongside designs; both producers and the UI validate against
 * exactly this contract.
 */
export const findingSchema = z.object({
  severity: z.enum(["info", "warning"]),
  /** Short machine-ish category, e.g. "hsrp-equal-priority" or "no-edge-firewall". */
  code: z.string().min(1),
  /** Human-readable observation, written for a network engineer. */
  message: z.string().min(1),
  /** Device names the finding concerns; empty when it's about the design as a whole. */
  devices: z.array(z.string()).default([]),
});

export type Finding = z.infer<typeof findingSchema>;
