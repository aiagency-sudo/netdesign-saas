import { z } from "zod";
import { firstHopRedundancySchema, igpSchema } from "./enums.js";
import { ipv4Schema } from "./primitives.js";

export const ospfAreaSchema = z.object({
  area: z.string().optional(),
  deviceIds: z.array(z.string()).optional(),
});
export type OspfArea = z.infer<typeof ospfAreaSchema>;

export const bgpPeerSchema = z.object({
  deviceId: z.string().optional(),
  peerIp: ipv4Schema.optional(),
  remoteAsn: z.number().int().optional(),
});
export type BgpPeer = z.infer<typeof bgpPeerSchema>;

export const bgpSchema = z.object({
  asn: z.number().int().optional(),
  peers: z.array(bgpPeerSchema).optional(),
});
export type Bgp = z.infer<typeof bgpSchema>;

export const routingSchema = z.object({
  igp: igpSchema.optional(),
  ospfAreas: z.array(ospfAreaSchema).optional(),
  bgp: bgpSchema.optional(),
  firstHopRedundancy: firstHopRedundancySchema.optional(),
  defaultRoute: z.string().optional(),
});
export type Routing = z.infer<typeof routingSchema>;
