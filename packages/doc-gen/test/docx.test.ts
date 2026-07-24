import { describe, expect, it } from "vitest";
import { generateHldDocx } from "../src/docx.js";
import { g1Design, g4Design } from "./fixtures.js";

describe("generateHldDocx", () => {
  it("produces a real OOXML zip (starts with the PK magic bytes) for G1", async () => {
    const buffer = await generateHldDocx(g1Design);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("hex")).toBe("504b");
  });

  it("produces a real OOXML zip for G4", async () => {
    const buffer = await generateHldDocx(g4Design);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("hex")).toBe("504b");
  });
});
