import { z } from "zod";
import { linkKindSchema } from "./enums.js";
import { ipv4CidrSchema } from "./primitives.js";

export const linkSchema = z.object({
  a: z.string().min(1, "deviceId or deviceId:interface"),
  b: z.string().min(1),
  kind: linkKindSchema.optional(),
  subnet: ipv4CidrSchema.optional(),
  label: z.string().optional(),
});
export type Link = z.infer<typeof linkSchema>;
