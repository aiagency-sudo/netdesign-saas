import { z } from "zod";

export const designPatternSchema = z.enum([
  "branch-office",
  "campus-collapsed-core",
  "campus-three-tier",
  "dc-leaf-spine",
  "smb-flat",
  "dmz-edge",
  "hybrid-cloud",
  "custom",
]);
export type DesignPattern = z.infer<typeof designPatternSchema>;

export const deviceRoleSchema = z.enum([
  "router",
  "core-switch",
  "distribution-switch",
  "access-switch",
  "firewall",
  "load-balancer",
  "wireless-controller",
  "access-point",
  "server",
  "cloud-gateway",
  "vpn-concentrator",
  "reverse-proxy",
  "internet",
  "generic",
]);
export type DeviceRole = z.infer<typeof deviceRoleSchema>;

export const vendorHintSchema = z.enum([
  "cisco-ios",
  "cisco-iosxe",
  "cisco-nxos",
  "fortinet-fortigate",
  "paloalto-panos",
  "aruba-aoscx",
  "hpe-comware",
  "arista-eos",
  "f5-tmos",
  "juniper-junos",
  "aws",
  "azure",
  "gcp",
  "generic",
]);
export type VendorHint = z.infer<typeof vendorHintSchema>;

export const linkKindSchema = z.enum([
  "ethernet",
  "fiber",
  "port-channel",
  "wan",
  "vpn-tunnel",
  "wireless",
  "virtual",
]);
export type LinkKind = z.infer<typeof linkKindSchema>;

export const segmentPurposeSchema = z.enum([
  "user",
  "voice",
  "guest",
  "management",
  "server",
  "dmz",
  "transit",
  "storage",
  "iot",
  "other",
]);
export type SegmentPurpose = z.infer<typeof segmentPurposeSchema>;

export const igpSchema = z.enum(["ospf", "eigrp", "isis", "static", "none"]);
export type Igp = z.infer<typeof igpSchema>;

export const firstHopRedundancySchema = z.enum(["hsrp", "vrrp", "glbp", "none"]);
export type FirstHopRedundancy = z.infer<typeof firstHopRedundancySchema>;

export const zonePolicyActionSchema = z.enum(["allow", "deny", "inspect"]);
export type ZonePolicyAction = z.infer<typeof zonePolicyActionSchema>;

export const natRuleKindSchema = z.enum(["snat-overload", "static", "dnat"]);
export type NatRuleKind = z.infer<typeof natRuleKindSchema>;

export const cloudProviderSchema = z.enum(["aws", "azure", "gcp"]);
export type CloudProvider = z.infer<typeof cloudProviderSchema>;

export const cloudConnectivitySchema = z.enum([
  "site-to-site-vpn",
  "direct-connect",
  "expressroute",
  "sd-wan",
]);
export type CloudConnectivity = z.infer<typeof cloudConnectivitySchema>;
