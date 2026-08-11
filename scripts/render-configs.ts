#!/usr/bin/env -S npx tsx
/**
 * Renders the per-device base configs for a design and prints them — the
 * fastest way to put a vendor template in front of a human for the
 * line-by-line review CLAUDE.md requires before a vendor ships.
 *
 * Unlike scripts/generate-design.ts this needs NO running services: config
 * generation is pure template rendering, so a fixture render is offline and
 * instant. Only --prose reaches the network (Claude, for intent extraction).
 *
 * Note: no `--` before the flags — under pnpm 10 a `--` separator makes pnpm
 * forward the flags into this script's own inner `pnpm run build` step, which
 * rejects them.
 *
 * Usage:
 *   pnpm configs --fixture g1-panos
 *   pnpm configs --fixture g1-panos --device fw-01
 *   pnpm configs --fixture g1 --out-dir out/g1-configs
 *   ANTHROPIC_API_KEY=... pnpm configs --prose "small office, Palo Alto at the edge..."
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { renderAllConfigs } from "@netdesign/config-gen";
import { composeDesign } from "@netdesign/design-engine";
import { createAnthropicExtractionClient, generateDesign } from "@netdesign/llm-extraction";
import { designParamsSchema, type Design, type DesignParams } from "@netdesign/schema";

/**
 * Golden-scenario presets, plus the `-panos` variants used to review the Palo
 * Alto templates: identical topology to their FortiGate twins, so any
 * difference in the rendered output is purely a vendor difference. Duplicated
 * from the test fixtures rather than imported — a script a human runs
 * shouldn't depend on test-only code (same call as generate-design.ts).
 */
const FIXTURES: Record<string, DesignParams> = {
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
  "g1-panos": designParamsSchema.parse({
    designPattern: "branch-office",
    siteName: "G1 Branch Office (Palo Alto edge)",
    intentSummary:
      "Branch office with dual HSRP routers, two access switches, and a Palo Alto edge firewall serving three VLANs.",
    siteSupernet: "10.30.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 2, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "paloalto-panos" },
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
  "g4-panos": designParamsSchema.parse({
    designPattern: "smb-flat",
    siteName: "G4 Small Office (Palo Alto edge)",
    intentSummary:
      "Single-router SMB design with one access switch and a Palo Alto edge firewall serving corp and guest VLANs.",
    siteSupernet: "10.40.0.0/16",
    router: { count: 1, redundancy: "none", vendorHint: "cisco-ios" },
    accessSwitch: { count: 1, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "paloalto-panos" },
    vlans: [
      { name: "corp", purpose: "user", dhcp: true },
      { name: "guest", purpose: "guest", dhcp: true },
    ],
  }),
  g2: designParamsSchema.parse({
    designPattern: "campus-three-tier",
    siteName: "G2 Campus",
    intentSummary:
      "Three-tier campus: HSRP edge routers behind a firewall, a pure-L3 core pair, an HSRP distribution pair as VLAN gateways, and six L2 access switches serving corp-data and voice.",
    siteSupernet: "10.20.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 6, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "fortinet-fortigate" },
    coreSwitch: { count: 2, vendorHint: "cisco-ios" },
    distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
    vlans: [
      { name: "corp-data", purpose: "user", dhcp: true },
      { name: "voice", purpose: "voice", dhcp: true },
    ],
  }),
  "g2-panos": designParamsSchema.parse({
    designPattern: "campus-three-tier",
    siteName: "G2 Campus (Palo Alto edge)",
    intentSummary:
      "Three-tier campus behind a Palo Alto edge firewall: HSRP edge routers, a pure-L3 core pair, an HSRP distribution pair as VLAN gateways, and six L2 access switches serving corp-data and voice.",
    siteSupernet: "10.20.0.0/16",
    router: { count: 2, redundancy: "hsrp", vendorHint: "cisco-ios" },
    accessSwitch: { count: 6, vendorHint: "cisco-ios" },
    firewall: { present: true, vendorHint: "paloalto-panos" },
    coreSwitch: { count: 2, vendorHint: "cisco-ios" },
    distributionSwitch: { count: 2, vendorHint: "cisco-ios" },
    vlans: [
      { name: "corp-data", purpose: "user", dhcp: true },
      { name: "voice", purpose: "voice", dhcp: true },
    ],
  }),
};

function printUsageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  pnpm configs --fixture <name> [--device <id>] [--out-dir <path>]",
      '  pnpm configs --prose "<requirements>" [--device <id>] [--out-dir <path>] [--model <model>]',
      "",
      "Options:",
      `  --fixture <name>   Canned design-params preset — no ANTHROPIC_API_KEY needed. One of: ${Object.keys(FIXTURES).join(", ")}.`,
      "  --prose <text>     Extract design-params from free-form prose via Claude (requires ANTHROPIC_API_KEY).",
      "  --device <id>      Print only this device's config (e.g. fw-01), instead of every device.",
      "  --out-dir <path>   Also write one <device-id>.txt per device into this directory.",
      "  --model <model>    Claude model override for --prose.",
    ].join("\n"),
  );
  process.exit(message ? 1 : 0);
}

async function buildDesign(values: { prose?: string; fixture?: string; model?: string }): Promise<Design> {
  if (values.prose && values.fixture) {
    printUsageAndExit("pass either --prose or --fixture, not both.");
  }

  if (values.fixture) {
    const params = FIXTURES[values.fixture];
    if (!params) {
      printUsageAndExit(`unknown --fixture "${values.fixture}". Valid options: ${Object.keys(FIXTURES).join(", ")}.`);
    }
    return composeDesign(params);
  }

  if (values.prose) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      printUsageAndExit("--prose requires the ANTHROPIC_API_KEY environment variable to be set.");
    }
    const client = createAnthropicExtractionClient();
    return generateDesign(values.prose, { client, ...(values.model ? { model: values.model } : {}) });
  }

  printUsageAndExit('pass either --prose "<requirements>" or --fixture <name>.');
}

async function main() {
  const { values } = parseArgs({
    options: {
      prose: { type: "string" },
      fixture: { type: "string" },
      device: { type: "string" },
      "out-dir": { type: "string" },
      model: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) printUsageAndExit();

  const design = await buildDesign(values);
  const configs = renderAllConfigs(design);
  const deviceIds = Object.keys(configs);

  // Devices whose vendor/role has no template yet are skipped by
  // renderAllConfigs, not errored — surface that here so a missing config is
  // visible rather than silent.
  const skipped = design.devices.filter((d) => !deviceIds.includes(d.id));

  console.error(
    `Design "${design.meta.name}": ${design.devices.length} devices, configs rendered for ${deviceIds.length}.`,
  );
  if (skipped.length > 0) {
    console.error(
      `No template yet for: ${skipped.map((d) => `${d.id} (${d.role}/${d.vendorHint})`).join(", ")}`,
    );
  }

  if (values.device) {
    const config = configs[values.device];
    if (!config) {
      printUsageAndExit(
        `no config rendered for device "${values.device}". Devices with configs: ${deviceIds.join(", ") || "(none)"}.`,
      );
    }
    console.log(config);
  } else {
    for (const deviceId of deviceIds) {
      console.log(`${"=".repeat(70)}\n=== ${deviceId}\n${"=".repeat(70)}\n`);
      console.log(configs[deviceId]);
    }
  }

  if (values["out-dir"]) {
    const outDir = values["out-dir"];
    await mkdir(outDir, { recursive: true });
    for (const deviceId of deviceIds) {
      await writeFile(join(outDir, `${deviceId}.txt`), configs[deviceId]!);
    }
    console.error(`Wrote ${deviceIds.length} config file(s) to ${outDir}/`);
  }
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
