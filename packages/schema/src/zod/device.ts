import { z } from "zod";
import { deviceRoleSchema, vendorHintSchema } from "./enums.js";
import { ipv4CidrSchema, ipv4Schema } from "./primitives.js";

export const sviSchema = z.object({
  vlanId: z.number().int(),
  /** This device's own CIDR address on that VLAN — distinct from the VLAN segment's shared gateway when multiple L3-capable devices (e.g. an HSRP pair) each need their own address on it. */
  ip: z.string().min(1),
});
export type Svi = z.infer<typeof sviSchema>;

export const interfaceSchema = z.object({
  name: z.string().min(1),
  ip: z.string().min(1).optional(),
  vlan: z.number().int().optional(),
  trunk: z.boolean().optional(),
  allowedVlans: z.array(z.number().int()).optional(),
  /** Per-VLAN L3 addresses on this trunk — only present on L3-capable devices (e.g. a router-on-a-stick); an access switch's trunk has none. */
  svis: z.array(sviSchema).optional(),
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
