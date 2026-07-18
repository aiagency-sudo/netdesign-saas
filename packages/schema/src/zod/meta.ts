import { z } from "zod";
import { designPatternSchema } from "./enums.js";

export const metaSchema = z.object({
  name: z.string().min(1),
  intentSummary: z.string().min(1),
  designPattern: designPatternSchema.optional(),
  assumptions: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});
export type Meta = z.infer<typeof metaSchema>;
