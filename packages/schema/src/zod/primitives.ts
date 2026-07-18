import { z } from "zod";

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)";
const IPV4_PATTERN = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const IPV4_CIDR_PATTERN = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}/(3[0-2]|[12]?\\d)$`);

/** A bare IPv4 address, e.g. "10.0.0.1". */
export const ipv4Schema = z.string().regex(IPV4_PATTERN, "Expected a dotted-quad IPv4 address");

/** An IPv4 network in CIDR notation, e.g. "10.0.0.0/24". */
export const ipv4CidrSchema = z.string().regex(IPV4_CIDR_PATTERN, "Expected IPv4 CIDR notation, e.g. 10.0.0.0/24");
