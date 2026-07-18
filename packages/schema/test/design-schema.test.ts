import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DesignValidationError, designSchema, parseDesign, safeParseDesign } from "../src/index.js";

const fixturePath = fileURLToPath(new URL("./fixtures/valid-minimal.json", import.meta.url));
const validMinimal: unknown = JSON.parse(readFileSync(fixturePath, "utf-8"));

describe("designSchema", () => {
  it("accepts a valid minimal design", () => {
    const design = parseDesign(validMinimal);
    expect(design.meta.name).toBe("smb-simple-test");
    expect(design.devices).toHaveLength(3);
  });

  it("rejects a design missing required top-level fields", () => {
    const { version, ...withoutVersion } = validMinimal as { version: string; [k: string]: unknown };
    void version;
    const result = safeParseDesign(withoutVersion);
    expect(result.success).toBe(false);
  });

  it("rejects the wrong schema version", () => {
    const result = safeParseDesign({ ...(validMinimal as object), version: "2.0" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty devices array (schema requires minItems 1)", () => {
    const result = safeParseDesign({ ...(validMinimal as object), devices: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a device id that is not lowercase kebab-case", () => {
    const bad = structuredClone(validMinimal) as { devices: Array<{ id: string }> };
    bad.devices[0]!.id = "RTR_01";
    const result = safeParseDesign(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown device role", () => {
    const bad = structuredClone(validMinimal) as { devices: Array<{ role: string }> };
    bad.devices[0]!.role = "quantum-router";
    const result = safeParseDesign(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a malformed CIDR on a segment", () => {
    const bad = structuredClone(validMinimal) as { segments: Array<{ cidr: string }> };
    bad.segments[0]!.cidr = "not-a-cidr";
    const result = safeParseDesign(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range VLAN id", () => {
    const bad = structuredClone(validMinimal) as { segments: Array<{ vlanId: number }> };
    bad.segments[0]!.vlanId = 5000;
    const result = safeParseDesign(bad);
    expect(result.success).toBe(false);
  });

  it("parseDesign throws a human-readable DesignValidationError", () => {
    expect(() => parseDesign({})).toThrow(DesignValidationError);
    try {
      parseDesign({});
    } catch (err) {
      expect(err).toBeInstanceOf(DesignValidationError);
      const message = (err as DesignValidationError).message;
      expect(message).toContain("failed schema validation");
      expect((err as DesignValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("designSchema is exported directly for consumers that need raw zod access", () => {
    expect(designSchema.safeParse(validMinimal).success).toBe(true);
  });
});
