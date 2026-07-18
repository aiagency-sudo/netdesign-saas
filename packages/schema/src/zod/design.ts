import { z } from "zod";
import { cloudSchema } from "./cloud.js";
import { deviceSchema } from "./device.js";
import { linkSchema } from "./link.js";
import { metaSchema } from "./meta.js";
import { routingSchema } from "./routing.js";
import { securitySchema } from "./security.js";
import { segmentSchema } from "./segment.js";

export const designSchema = z.object({
  version: z.literal("1.0"),
  meta: metaSchema,
  devices: z.array(deviceSchema).min(1),
  links: z.array(linkSchema),
  segments: z.array(segmentSchema),
  routing: routingSchema.optional(),
  security: securitySchema.optional(),
  cloud: cloudSchema.optional(),
});
export type Design = z.infer<typeof designSchema>;
