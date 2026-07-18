import { z } from "zod";
import { segmentPurposeSchema } from "./enums.js";
import { ipv4CidrSchema, ipv4Schema } from "./primitives.js";

export const segmentSchema = z.object({
  name: z.string().min(1),
  vlanId: z.number().int().min(1).max(4094).optional(),
  cidr: ipv4CidrSchema,
  gateway: ipv4Schema.optional(),
  zone: z.string().optional(),
  purpose: segmentPurposeSchema.optional(),
  dhcp: z.boolean().optional(),
});
export type Segment = z.infer<typeof segmentSchema>;
