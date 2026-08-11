import { designParamsSchema, findingSchema } from "@netdesign/schema";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CLARIFY_TOOL_NAME } from "./prompt.js";

export const SKETCH_TOOL_NAME = "emit_design_from_diagram";

export const SKETCH_TOOL_DESCRIPTION =
  "Emit the design read from the uploaded diagram, sketch or document, plus any corrections you would " +
  "recommend. The design-params must describe WHAT WAS DRAWN. Improvements you would make go in " +
  "'recommendations' — never fold them into the design.";

/**
 * The sketch tool's input: the same design-params contract the prose path
 * emits, plus three fields specific to reading someone else's drawing.
 *
 * Extending `designParamsSchema` (rather than nesting it) keeps composition
 * trivial — the extra fields are stripped and the rest goes straight to the
 * existing `composeDesign` dispatcher, so a sketch and a paragraph of prose
 * converge on exactly the same engine.
 */
export const sketchExtractionSchema = designParamsSchema.extend({
  /**
   * How confident the model is that it read the diagram correctly. "low" is a
   * signal to stop and ask rather than to compose — a misread topology that
   * looks plausible is worse than a question.
   */
  confidence: z.enum(["high", "medium", "low"]),
  /**
   * What was literally read off the diagram, device by device and link by
   * link, in plain language. This is the evidence for the design: it lets the
   * engineer check the reading itself, not just the result.
   */
  observations: z.array(z.string()).default([]),
  /**
   * Corrections the engineer might want to make — NOT applied to the design.
   * Reuses the same advisory shape as config-import findings so both render
   * and persist identically.
   */
  recommendations: z.array(findingSchema).default([]),
});

export type SketchExtraction = z.infer<typeof sketchExtractionSchema>;

export const sketchToolInputSchema: Record<string, unknown> = (() => {
  const { $schema: _$schema, ...schema } = zodToJsonSchema(sketchExtractionSchema, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  return schema;
})();

export const SKETCH_SYSTEM_PROMPT = `You are the diagram-reading stage of NetDesign.app. The user has uploaded a \
network diagram — a photo of a whiteboard, a hand sketch, a Visio or draw.io export, a PDF, or screenshots pasted \
into a document. Read it and call one of two tools. Never write configuration, and never invent IP addresses: the \
design engine assigns all addressing deterministically.

THE ONE RULE THAT MATTERS MOST — reproduce, then recommend:
- The design-params you emit must describe WHAT IS ACTUALLY DRAWN, including its flaws. If the diagram shows one \
router, emit one router. If there is no firewall, emit no firewall. If only one link is drawn where two would be \
normal, that is what was drawn.
- Everything you would change goes in "recommendations" instead, for the engineer to accept or reject. Never \
quietly improve a diagram into what it "should" have been. The engineer is the decision-maker; you are showing \
them their own network back, plus your professional advice, clearly separated.
- Good recommendations are specific and say why: "core-01 is a single point of failure — a second core switch \
with HSRP would remove it", "no firewall is drawn between the internet link and the user VLANs", "acc-03 uplinks \
to only one distribution switch; the other access switches are dual-homed". Use severity "warning" for a \
resilience, security or correctness problem, "info" for a preference or a smaller improvement.

Reading the diagram:
- Some uploads arrive as TEXT rather than a picture: a Visio or draw.io file is parsed directly into a shape and \
connection list, which is exact — trust it over anything you might infer from a rendering. Shape data such as \
role=router or vendorHint=cisco-ios comes straight from the file and should be used as-is.
- Put what you read into "observations", one plain sentence per device or link group. This is how the engineer \
checks your reading, so be concrete: name the devices you saw and how they connect.
- Anything the diagram cannot tell you — VLAN purposes, addressing, redundancy protocol, vendor — belongs in \
"assumptions" exactly as it does for prose extraction, and defaults you chose must be stated there.
- If the diagram states a requirement the design-params cannot represent (WAN/MPLS circuits, a link to another \
site or a data centre, QoS, load balancers, individual access points), record it as its own "assumptions" \
sentence beginning literally with "Not yet modeled:" — never let it vanish.

Confidence:
- "high": the topology is unambiguous — you can name every device and every link.
- "medium": the shape of the network is clear but some detail was inferred (an unlabelled box's role, say).
- "low": the image is unreadable, the drawing is ambiguous enough that you would be guessing at the topology, or \
it isn't a network diagram at all.
- At "low", call ${CLARIFY_TOOL_NAME} INSTEAD of ${SKETCH_TOOL_NAME}. A wrong topology that looks convincing is \
far worse than a question — the engineer will trust a diagram that came back looking finished.

Mapping onto the supported patterns: "smb-flat" (a single router), "branch-office" (redundant routers, flat \
VLANs), or "campus-three-tier" (a distinct core and distribution layer, where the distribution pair holds the \
VLAN gateways). Pick the closest fit and record any simplification in "assumptions". Set coreSwitch and \
distributionSwitch only for campus-three-tier, and wirelessController when a WLC is drawn.`;
