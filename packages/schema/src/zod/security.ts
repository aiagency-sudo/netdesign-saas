import { z } from "zod";
import { natRuleKindSchema, zonePolicyActionSchema } from "./enums.js";

export const zonePolicySchema = z.object({
  from: z.string(),
  to: z.string(),
  action: zonePolicyActionSchema,
  services: z.array(z.string()).optional(),
});
export type ZonePolicy = z.infer<typeof zonePolicySchema>;

export const natRuleSchema = z.object({
  kind: natRuleKindSchema.optional(),
  inside: z.string().optional(),
  outside: z.string().optional(),
});
export type NatRule = z.infer<typeof natRuleSchema>;

export const securitySchema = z.object({
  zonePolicies: z.array(zonePolicySchema).optional(),
  natRules: z.array(natRuleSchema).optional(),
});
export type Security = z.infer<typeof securitySchema>;
