import { z } from "zod";
import { cloudConnectivitySchema, cloudProviderSchema } from "./enums.js";

export const vpcSchema = z.object({
  name: z.string().optional(),
  cidr: z.string().optional(),
  subnets: z.array(z.string()).optional(),
});
export type Vpc = z.infer<typeof vpcSchema>;

export const cloudSchema = z.object({
  provider: cloudProviderSchema.optional(),
  vpcs: z.array(vpcSchema).optional(),
  connectivity: cloudConnectivitySchema.optional(),
});
export type Cloud = z.infer<typeof cloudSchema>;
