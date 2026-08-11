import { designParamsSchema, type DesignParams } from "@netdesign/schema";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const TOOL_NAME = "emit_design_params";

export const TOOL_DESCRIPTION =
  "Emit the structured design-params extracted from the user's network requirements prose. " +
  "Supported topologies: branch-office and smb-flat (N redundant routers, M access switches, an " +
  "optional edge firewall, a flat set of VLANs) and campus-three-tier (a three-tier campus: an " +
  "optional edge firewall and redundant routers, a pure-L3 core pair, an HSRP distribution pair that " +
  "serves as the VLAN gateways, L2 access switches, and an optional wireless LAN controller).";

/**
 * JSON Schema for the extraction tool's input, derived directly from
 * designParamsSchema so the tool definition can never drift from the zod
 * contract the response is validated against.
 */
export const toolInputSchema: Record<string, unknown> = (() => {
  const { $schema: _$schema, ...schema } = zodToJsonSchema(designParamsSchema, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  return schema;
})();

export const CLARIFY_TOOL_NAME = "ask_clarifying_questions";

export const CLARIFY_TOOL_DESCRIPTION =
  "Call this INSTEAD of emit_design_params when the prose is too ambiguous to map onto branch-office, " +
  "smb-flat, or campus-three-tier even as a reasonable guess — e.g. the topology described doesn't resemble " +
  "any of the three patterns at all (a leaf-spine data-center fabric or a hybrid-cloud design, say), " +
  "or a load-bearing fact (how many routers/switches, whether redundancy is wanted) is genuinely unknowable " +
  "from what the user wrote. Ask 1-3 short, specific questions that would let a second attempt succeed.";

export const clarifyingQuestionsSchema = z.object({
  questions: z
    .array(z.string().min(1))
    .min(1)
    .max(3)
    .describe("1-3 short, specific questions to ask the user before a design can be extracted."),
});

export type ClarifyingQuestions = z.infer<typeof clarifyingQuestionsSchema>;

export const clarifyToolInputSchema: Record<string, unknown> = (() => {
  const { $schema: _$schema, ...schema } = zodToJsonSchema(clarifyingQuestionsSchema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  return schema;
})();

interface FewShotExample {
  prose: string;
  params: DesignParams;
}

/**
 * Five worked examples spanning all three supported patterns, varying vendor,
 * redundancy, and switch/router count (example 3 has more switches than
 * routers, exercising the round-robin uplink case the composer handles;
 * example 4 is the three-tier campus with its core + distribution pairs;
 * example 5 shows a stated-but-unmodeled requirement — MPLS circuits — captured
 * as a "Not yet modeled:" assumption instead of being silently dropped).
 * Each is parsed through designParamsSchema at module load so a typo here
 * fails immediately instead of silently degrading extraction quality.
 */
const EXAMPLES: FewShotExample[] = [
  {
    prose:
      "We need a branch office design: two redundant routers running HSRP, each uplinked to its own access " +
      "switch, with a FortiGate firewall at the edge. Three VLANs: corporate data, voice, and guest wifi.",
    params: designParamsSchema.parse({
      designPattern: "branch-office",
      siteName: "Branch Office",
      intentSummary:
        "Branch office with dual HSRP routers, two access switches, and a FortiGate edge firewall serving three VLANs.",
      router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
      accessSwitch: { count: 2, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "fortinet-fortigate" },
      vlans: [
        { name: "corp-data", purpose: "user", dhcp: true },
        { name: "voice", purpose: "voice", dhcp: true },
        { name: "guest", purpose: "guest", dhcp: true },
      ],
      assumptions: ["No IP address range was given; the engine will assign one."],
    }),
  },
  {
    prose:
      "Small office: just one router, one switch, and a firewall for internet edge protection. We need a " +
      "corporate VLAN and a separate guest VLAN for visitors.",
    params: designParamsSchema.parse({
      designPattern: "smb-flat",
      siteName: "Small Office",
      intentSummary:
        "Single-router SMB design with one access switch and an edge firewall, serving a corporate VLAN and a guest VLAN.",
      router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
      accessSwitch: { count: 1, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "fortinet-fortigate" },
      vlans: [
        { name: "corp", purpose: "user", dhcp: true },
        { name: "guest", purpose: "guest", dhcp: true },
      ],
      assumptions: [],
    }),
  },
  {
    prose:
      "One router is fine — no need for redundancy — but we have two separate access switches on different " +
      "floors, both need to reach the network. Put a Palo Alto firewall at the edge. We need a staff VLAN and " +
      "an IoT VLAN for badge readers and cameras.",
    params: designParamsSchema.parse({
      designPattern: "smb-flat",
      siteName: "Two-Floor Office",
      intentSummary:
        "Single-router design with two access switches (one per floor) and a Palo Alto edge firewall, serving staff and IoT VLANs.",
      router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
      accessSwitch: { count: 2, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "paloalto-panos" },
      vlans: [
        { name: "staff", purpose: "user", dhcp: true },
        { name: "iot", purpose: "iot", dhcp: false },
      ],
      assumptions: [
        "No IP address range was given; the engine will assign one.",
        "Assumed both access switches uplink to the single router.",
      ],
    }),
  },
  {
    prose:
      "Design a campus for our headquarters. We want the classic three-tier: a redundant core, a pair of " +
      "distribution switches acting as the layer-3 gateways for the user VLANs, and about six access switches " +
      "across the floors. Two edge routers behind a FortiGate for the internet edge. Users need a data VLAN and " +
      "a voice VLAN for the phones. Wifi is run from a central wireless controller with about 40 access points, " +
      "and staff wifi should sit on its own subnet.",
    params: designParamsSchema.parse({
      designPattern: "campus-three-tier",
      siteName: "Headquarters Campus",
      intentSummary:
        "Three-tier campus: dual edge routers behind a FortiGate, a redundant L3 core, an HSRP distribution pair as the VLAN gateways, six access switches serving data, voice and staff-wifi VLANs, and a central wireless controller.",
      router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
      accessSwitch: { count: 6, vendorHint: "cisco-ios" },
      firewall: { present: true, vendorHint: "fortinet-fortigate" },
      coreSwitch: { count: 2, vendorHint: "cisco-ios" },
      distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
      wirelessController: { present: true, vendorHint: "cisco-ios" },
      vlans: [
        { name: "corp-data", purpose: "user", dhcp: true },
        { name: "voice", purpose: "voice", dhcp: true },
        { name: "staff-wifi", purpose: "user", dhcp: true },
      ],
      assumptions: [
        "No IP address range was given; the engine will assign one.",
        "Not yet modeled: the 40 access points — the controller is modeled, individual APs and RF coverage are not.",
      ],
    }),
  },
  {
    prose:
      "Small branch office for about 50 users, each with an IP phone. The office also has 4 security cameras. I " +
      "want users and cameras segregated. Two MPLS circuits connect the site back to our main data centre.",
    params: designParamsSchema.parse({
      designPattern: "branch-office",
      siteName: "Branch Office",
      intentSummary:
        "Branch office for ~50 users (a phone each) with four segregated security cameras — users, voice, and cameras on separate VLANs. The two MPLS circuits to the data centre are noted but not yet modeled.",
      router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
      accessSwitch: { count: 2, vendorHint: "cisco-ios" },
      firewall: { present: false, vendorHint: "fortinet-fortigate" },
      vlans: [
        { name: "users", purpose: "user", dhcp: true },
        { name: "voice", purpose: "voice", dhcp: true },
        { name: "cameras", purpose: "iot", dhcp: true },
      ],
      assumptions: [
        "No IP address range was given; the engine will assign one.",
        "Not yet modeled: the two MPLS circuits to the main data centre — this design covers the branch LAN and edge only; WAN/MPLS connectivity and provider routing are not represented yet.",
        "No firewall was mentioned; none was included at the edge.",
      ],
    }),
  },
];

function formatExample(example: FewShotExample, index: number): string {
  return `Example ${index + 1}:\nUser: "${example.prose}"\nExpected ${TOOL_NAME} input:\n${JSON.stringify(example.params, null, 2)}`;
}

export const SYSTEM_PROMPT = `You are the intent-extraction stage of NetDesign.app. Read the user's network \
requirements prose and call one of two tools — never write config, never invent IP addresses (the design \
engine assigns those deterministically).

Call ${TOOL_NAME} whenever "branch-office", "smb-flat", or "campus-three-tier" is a reasonable fit, even an \
imperfect one — pick the closest and record any simplification you made as a plain sentence in "assumptions". \
Only reach for ${CLARIFY_TOOL_NAME} instead when no pattern is a reasonable guess at all, or a fact you'd need to \
invent outright (not simplify or infer) to proceed is missing — e.g. the topology is a leaf-spine data-center \
fabric or a hybrid-cloud design that doesn't resemble any of the three patterns, or the prose gives no usable \
signal on device counts whatsoever. Prefer emitting design-params over asking; only ask when a guess would be a \
fabrication, not a simplification.

Rules for ${TOOL_NAME}:
- "branch-office" implies router redundancy is expected/likely; "smb-flat" implies a single router. "campus-three-tier" \
is for a full three-tier campus — a distinct core and distribution layer, where distribution switches (not the routers) \
are the layer-3 gateways for the user VLANs. Reach for it when the user talks about core/distribution/access tiers, a \
campus, or SVIs on the distribution switches; otherwise prefer a flat pattern. Prefer the pattern that matches what the \
user described, but let router.count/redundancy be the source of truth.
- For "campus-three-tier", set coreSwitch and distributionSwitch (a pair each); leave them unset for the flat patterns.
- Set wirelessController.present on a campus when the user mentions a wireless controller / WLC / centrally-managed \
wifi. The controller is modeled as a device trunked to the distribution pair; individual access points are not \
modeled, so if the user gave AP counts or coverage requirements, record that as its own "Not yet modeled:" \
assumption. A wireless SSID that needs its own subnet is just a VLAN — add it to "vlans" like any other. \
wirelessController belongs to campus-three-tier only; for a flat pattern, treat a controller as unmodeled.
- Every fact you had to guess because the user didn't state it belongs in "assumptions" as a plain sentence — \
this is what gets shown back to the user for confirmation, so it must be human-readable, not a code.
- If the user states a requirement the design-params here CANNOT represent — e.g. WAN/MPLS/SD-WAN circuits, a \
connection to another site or a data centre, QoS, specific provider/WAN routing, individual access points, load \
balancers — do NOT silently drop it and do NOT pretend the design covers it. Design the part you can (the LAN and \
edge), and record EACH unmodeled requirement as its own "assumptions" sentence beginning literally with \
"Not yet modeled:" so the user can see exactly what was set aside (e.g. "Not yet modeled: the two MPLS circuits to \
the data centre — this design covers the branch LAN and edge only."). Never let a stated requirement vanish without a trace.
- Keep "intentSummary" to 1-2 sentences restating what you understood.
- VLAN names should be short, lowercase, kebab-case identifiers (e.g. "corp-data", "guest", "voice").

Rules for ${CLARIFY_TOOL_NAME}:
- Ask 1-3 short, specific questions — each one should unblock extraction on the next attempt.
- Don't ask about things the engine can safely default (like IP ranges); those belong in "assumptions" instead.

${EXAMPLES.map(formatExample).join("\n\n")}`;
