import { z } from "zod";
import { deviceRoleSchema, vendorHintSchema } from "./enums.js";
import { ipv4CidrSchema, ipv4Schema } from "./primitives.js";

export const interfaceSchema = z.object({
  name: z.string().min(1),
  ip: z.string().min(1).optional(),
  vlan: z.number().int().optional(),
  trunk: z.boolean().optional(),
  allowedVlans: z.array(z.number().int()).optional(),
  description: z.string().optional(),
});
export type Interface = z.infer<typeof interfaceSchema>;

export const deviceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "Device id must be lowercase kebab-case, e.g. core-rtr-01"),
  hostname: z.string().optional(),
  role: deviceRoleSchema,
  vendorHint: vendorHintSchema,
  model: z.string().optional(),
  mgmtIp: ipv4Schema.optional(),
  loopback: ipv4CidrSchema.optional(),
  redundancyGroup: z.string().optional(),
  zone: z.string().optional(),
  interfaces: z.array(interfaceSchema).optional(),
});
export type Device = z.infer<typeof deviceSchema>;
