import { describe, expect, it } from "vitest";
import {
  cloudConnectivitySchema,
  cloudProviderSchema,
  designPatternSchema,
  designSchemaJson,
  deviceRoleSchema,
  firstHopRedundancySchema,
  igpSchema,
  linkKindSchema,
  natRuleKindSchema,
  segmentPurposeSchema,
  vendorHintSchema,
  zonePolicyActionSchema,
} from "../src/index.js";

/**
 * design-schema.json is the contract of record (per CLAUDE.md). These zod
 * schemas are hand-authored to mirror it. This suite fails the moment the two
 * drift apart, so a schema edit that forgets the matching zod update is
 * caught in CI rather than at runtime.
 */

type JsonSchemaObject = {
  required?: string[];
  properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }>;
};

const root = designSchemaJson as unknown as JsonSchemaObject;

function enumAt(path: string[]): string[] {
  let node: { properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> }; enum?: string[] } =
    root as unknown as { properties: Record<string, unknown> };
  for (const key of path) {
    const container = (node.properties ?? node.items?.properties ?? {}) as Record<string, typeof node>;
    const next = container[key];
    if (!next) throw new Error(`Path not found in design-schema.json: ${path.join(".")}`);
    node = next;
  }
  if (!node.enum) throw new Error(`No enum at path in design-schema.json: ${path.join(".")}`);
  return node.enum;
}

describe("zod schemas stay in sync with design-schema.json", () => {
  it("top-level required fields match", () => {
    expect(new Set(root.required)).toEqual(new Set(["version", "meta", "devices", "links", "segments"]));
  });

  it("device.role enum matches", () => {
    expect(new Set(deviceRoleSchema.options)).toEqual(new Set(enumAt(["devices", "role"])));
  });

  it("device.vendorHint enum matches", () => {
    expect(new Set(vendorHintSchema.options)).toEqual(new Set(enumAt(["devices", "vendorHint"])));
  });

  it("meta.designPattern enum matches", () => {
    expect(new Set(designPatternSchema.options)).toEqual(new Set(enumAt(["meta", "designPattern"])));
  });

  it("links.kind enum matches", () => {
    expect(new Set(linkKindSchema.options)).toEqual(new Set(enumAt(["links", "kind"])));
  });

  it("segments.purpose enum matches", () => {
    expect(new Set(segmentPurposeSchema.options)).toEqual(new Set(enumAt(["segments", "purpose"])));
  });

  it("routing.igp and firstHopRedundancy enums match", () => {
    const routingProps = (root.properties["routing"] as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(new Set(igpSchema.options)).toEqual(new Set(routingProps["igp"]!.enum));
    expect(new Set(firstHopRedundancySchema.options)).toEqual(new Set(routingProps["firstHopRedundancy"]!.enum));
  });

  it("security enums match", () => {
    const securityProps = (root.properties["security"] as { properties: Record<string, unknown> }).properties;
    const zonePolicyAction = (
      (securityProps["zonePolicies"] as { items: { properties: Record<string, { enum?: string[] }> } }).items
        .properties["action"]! as { enum: string[] }
    ).enum;
    const natRuleKind = (
      (securityProps["natRules"] as { items: { properties: Record<string, { enum?: string[] }> } }).items.properties[
        "kind"
      ]! as { enum: string[] }
    ).enum;
    expect(new Set(zonePolicyActionSchema.options)).toEqual(new Set(zonePolicyAction));
    expect(new Set(natRuleKindSchema.options)).toEqual(new Set(natRuleKind));
  });

  it("cloud enums match", () => {
    const cloudProps = (root.properties["cloud"] as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(new Set(cloudProviderSchema.options)).toEqual(new Set(cloudProps["provider"]!.enum));
    expect(new Set(cloudConnectivitySchema.options)).toEqual(new Set(cloudProps["connectivity"]!.enum));
  });
});
