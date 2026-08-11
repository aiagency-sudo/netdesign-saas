import type { DeviceRole, VendorHint } from "@netdesign/schema";

/**
 * Facts extracted verbatim from ONE uploaded device config. This is a faithful
 * record of what the file said — nothing is invented, corrected, or filled in.
 * Anything the config didn't state stays undefined, and any judgement about it
 * is reported as a {@link Finding}, never written into these facts.
 */
export interface ParsedInterface {
  /** Interface name exactly as written in the config, e.g. "GigabitEthernet0/1". */
  name: string;
  description?: string;
  /** The device's own address, as CIDR — derived from `ip address <ip> <mask>`. */
  ip?: string;
  shutdown: boolean;
  /** `switchport mode trunk` was present. */
  trunk: boolean;
  /** From `switchport trunk allowed vlan 10,20,30`. */
  allowedVlans?: number[];
  /** From `switchport access vlan 20`. */
  accessVlan?: number;
  /** The VLAN id when this is an SVI (`interface Vlan10`). */
  sviVlanId?: number;
  /** The dot1Q tag when this is a subinterface (`encapsulation dot1Q 10`). */
  encapsulationVlanId?: number;
  /** HSRP/standby config on this interface, if any. */
  hsrp?: ParsedHsrp;
}

export interface ParsedHsrp {
  group: number;
  virtualIp?: string;
  priority?: number;
  preempt: boolean;
}

export interface ParsedOspfNetwork {
  network: string;
  wildcard: string;
  area: string;
}

export interface ParsedOspf {
  processId: number;
  networks: ParsedOspfNetwork[];
  passiveInterfaces: string[];
  defaultInformationOriginate: boolean;
}

export interface ParsedStaticRoute {
  prefix: string;
  netmask: string;
  nextHop: string;
}

export interface ParsedVlan {
  id: number;
  name?: string;
}

export interface ParsedDevice {
  /** From `hostname X`; falls back to the upload's filename when the config omits it. */
  hostname: string;
  vendorHint: VendorHint;
  interfaces: ParsedInterface[];
  vlans: ParsedVlan[];
  ospf?: ParsedOspf;
  staticRoutes: ParsedStaticRoute[];
  ipRoutingEnabled: boolean;
  /** Config lines the parser did not understand — surfaced so nothing is silently ignored. */
  unparsedLines: string[];
  /**
   * How many config lines the parser actually looked at — every line except
   * blanks, `!` comments and `end`. Recorded here, where the skip rule lives,
   * so coverage ("12 of 143 lines not recognised") can be reported without a
   * second copy of that rule drifting out of sync.
   */
  consideredLineCount: number;
  /** The original text, kept verbatim. The uploaded config is the source of truth and is never rewritten. */
  sourceText: string;
  /** Filename it came from, for reporting. */
  sourceName: string;
}

/**
 * An advisory observation about the uploaded configuration. Findings are
 * REPORTING ONLY: they never mutate the parsed facts and never contain
 * generated configuration lines. The engineer's config stands as written.
 */
/**
 * Re-exported from `@netdesign/schema`, where the advisory contract now lives
 * so that sketch-import recommendations and config-import findings are the
 * same shape — one persisted format, one UI. Importing `Finding` from this
 * package remains valid.
 */
export type { Finding } from "@netdesign/schema";

export interface RoleInference {
  role: DeviceRole;
  /** Why the role was chosen — surfaced as an assumption so the user can correct it. */
  reason: string;
}
