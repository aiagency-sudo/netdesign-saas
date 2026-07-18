import { z } from "zod";
import { firstHopRedundancySchema, segmentPurposeSchema, vendorHintSchema } from "./enums.js";
import { ipv4CidrSchema } from "./primitives.js";

/**
 * The intermediate contract between LLM intent extraction and the design
 * engine's composer — narrower and less strict than the final design schema.
 * `designPattern` is deliberately limited to patterns the engine can
 * currently compose; extend it only alongside a matching composer.
 */
export const designParamsPatternSchema = z.enum(["branch-office", "smb-flat"]);
export type DesignParamsPattern = z.infer<typeof designParamsPatternSchema>;

export const designParamsVlanSchema = z.object({
  name: z.string().min(1),
  purpose: segmentPurposeSchema.default("user"),
  dhcp: z.boolean().default(true),
});
export type DesignParamsVlan = z.infer<typeof designParamsVlanSchema>;

export const designParamsSchema = z.object({
  designPattern: designParamsPatternSchema,
  siteName: z.string().min(1),
  intentSummary: z.string().min(1),
  /** CIDR the design engine should carve addressing from. Omitted when the user didn't state one — the engine picks a default and surfaces it as an assumption. */
  siteSupernet: ipv4CidrSchema.optional(),
  router: z.object({
    count: z.number().int().min(1).max(2),
    redundancy: firstHopRedundancySchema.default("none"),
    vendorHint: vendorHintSchema.default("cisco-ios"),
  }),
  accessSwitch: z.object({
    count: z.number().int().min(1).max(4),
    vendorHint: vendorHintSchema.default("cisco-ios"),
  }),
  firewall: z.object({
    present: z.boolean(),
    vendorHint: vendorHintSchema.default("fortinet-fortigate"),
  }),
  vlans: z.array(designParamsVlanSchema).min(1),
  /** Everything the LLM had to assume that the user didn't state — forwarded into the composed design's meta.assumptions. */
  assumptions: z.array(z.string()).default([]),
});
export type DesignParams = z.infer<typeof designParamsSchema>;
