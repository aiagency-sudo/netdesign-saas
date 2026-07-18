#!/usr/bin/env -S npx tsx
/**
 * BUILD_PLAN Session 4: "Wire engine -> vsdx service end-to-end via a CLI
 * script." Takes either free-form prose (via the LLM extraction + design
 * engine pipeline) or a canned golden-scenario preset, POSTs the resulting
 * design JSON to a running services/vsdx instance's /export endpoint, and
 * saves the returned .vsdx to disk.
 *
 * Usage:
 *   pnpm generate -- --fixture g1
 *   pnpm generate -- --fixture g4 --out out/g4.vsdx
 *   ANTHROPIC_API_KEY=... pnpm generate -- --prose "branch office with two routers..."
 *
 * Requires: `pnpm run build` (workspace packages must have dist/ built —
 * the root `generate` script does this for you) and a running vsdx service
 * (`cd services/vsdx && source .venv/bin/activate && uvicorn app.main:app`).
 */

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { composeBranchOfficeDesign } from "@netdesign/design-engine";
import { createAnthropicExtractionClient, generateBranchOfficeDesign } from "@netdesign/llm-extraction";
import { designParamsSchema, type Design, type DesignParams } from "@netdesign/schema";

const DEFAULT_VSDX_URL = "http://127.0.0.1:8000";

/**
 * The same G1/G4 golden scenarios used throughout the test suites
 * (packages/design-engine/test/golden/fixtures/), duplicated here rather
 * than imported so this script never reaches into test-only code.
 */
const GOLDEN_FIXTURES: Record<string, DesignParams> = {
  g1: designParamsSchema.parse({
    designPattern: "branch-office",
    siteName: "G1 Branch Office",
    intentSummary:
      "Branch office with dual HSRP routers, two access switches, and an edge firewall serving three VLANs.",
    siteSupernet: "10.30.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 2, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "fortinet-fortigate" },
    vlans: [
      { name: "corp-data", purpose: "user", dhcp: true },
      { name: "voice", purpose: "voice", dhcp: true },
      { name: "guest", purpose: "guest", dhcp: true },
    ],
  }),
  g4: designParamsSchema.parse({
    designPattern: "smb-flat",
    siteName: "G4 Small Office",
    intentSummary: "Single-router SMB design with one access switch and an edge firewall serving corp and guest VLANs.",
    siteSupernet: "10.40.0.0/16",
    router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
    accessSwitch: { count: 1, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "fortinet-fortigate" },
    vlans: [
      { name: "corp", purpose: "user", dhcp: true },
      { name: "guest", purpose: "guest", dhcp: true },
    ],
  }),
};

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  pnpm generate -- --fixture <g1|g4> [--out <path>] [--vsdx-url <url>]",
      "  pnpm generate -- --prose \"<requirements>\" [--out <path>] [--vsdx-url <url>] [--model <model>]",
      "",
      "Options:",
      "  --fixture <name>       Use a canned golden-scenario design-params preset (g1, g4) — no ANTHROPIC_API_KEY needed.",
      "  --prose <text>         Extract design-params from free-form prose via Claude (requires ANTHROPIC_API_KEY).",
      "  --out <path>           Where to write the .vsdx (default: derived from the design's name).",
      "  --design-json-out <path>  Also write the intermediate design JSON here, for inspection.",
      "  --vsdx-url <url>       Base URL of the running vsdx service (default: " + DEFAULT_VSDX_URL + ").",
      "  --model <model>        Claude model override for --prose (default: the llm-extraction package default).",
    ].join("\n"),
  );
  process.exit(message ? 1 : 0);
}

async function buildDesign(values: {
  prose?: string;
  fixture?: string;
  model?: string;
}): Promise<Design> {
  if (values.prose && values.fixture) {
    printUsageAndExit("pass either --prose or --fixture, not both.");
  }

  if (values.fixture) {
    const params = GOLDEN_FIXTURES[values.fixture];
    if (!params) {
      printUsageAndExit(`unknown --fixture "${values.fixture}". Valid options: ${Object.keys(GOLDEN_FIXTURES).join(", ")}.`);
    }
    return composeBranchOfficeDesign(params);
  }

  if (values.prose) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      printUsageAndExit("--prose requires the ANTHROPIC_API_KEY environment variable to be set.");
    }
    const client = createAnthropicExtractionClient();
    return generateBranchOfficeDesign(values.prose, { client, ...(values.model ? { model: values.model } : {}) });
  }

  printUsageAndExit("pass either --prose \"<requirements>\" or --fixture <g1|g4>.");
}

async function exportToVsdx(design: Design, vsdxUrl: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(`${vsdxUrl.replace(/\/$/, "")}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design),
    });
  } catch (cause) {
    throw new Error(
      `Could not reach the vsdx service at ${vsdxUrl}. Is it running?\n` +
        "  cd services/vsdx && source .venv/bin/activate && uvicorn app.main:app\n" +
        `(${(cause as Error).message})`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      detail = JSON.parse(body).detail ?? body;
    } catch {
      // not JSON — use the raw body
    }
    throw new Error(`vsdx service returned ${response.status}: ${detail}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design"
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      prose: { type: "string" },
      fixture: { type: "string" },
      out: { type: "string" },
      "design-json-out": { type: "string" },
      "vsdx-url": { type: "string", default: DEFAULT_VSDX_URL },
      model: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) printUsageAndExit();

  const design = await buildDesign(values);
  console.log(`Composed design "${design.meta.name}": ${design.devices.length} devices, ${design.links.length} links.`);

  if (values["design-json-out"]) {
    await writeFile(values["design-json-out"], JSON.stringify(design, null, 2));
    console.log(`Wrote design JSON to ${values["design-json-out"]}`);
  }

  const vsdxUrl = values["vsdx-url"] ?? DEFAULT_VSDX_URL;
  const vsdxBytes = await exportToVsdx(design, vsdxUrl);

  const outPath = values.out ?? `${slugify(design.meta.name)}.vsdx`;
  await writeFile(outPath, vsdxBytes);
  console.log(`Wrote ${vsdxBytes.length} bytes to ${outPath}`);
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
