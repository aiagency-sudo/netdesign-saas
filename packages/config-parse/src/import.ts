import { parseCiscoIosConfig, splitDeviceConfigs } from "./cisco-ios.js";
import { assembleDesign, type AssembleOptions, type ConfigToDesignResult } from "./assemble.js";
import type { ParsedDevice } from "./types.js";

export interface UploadedConfig {
  /** Filename as uploaded — used for reporting and as a hostname fallback. */
  name: string;
  /** The raw configuration text, exactly as the user provided it. */
  text: string;
}

export class UnsupportedConfigError extends Error {}

/**
 * Detects the vendor of an uploaded config from its own syntax. Deliberately
 * conservative: only cisco-ios/ios-xe is supported today, and anything else is
 * rejected loudly rather than half-parsed into a misleading design.
 */
export function detectVendor(text: string): "cisco-ios" | null {
  const looksCisco =
    /^\s*interface\s+\S+/m.test(text) ||
    /^\s*hostname\s+\S+/m.test(text) ||
    /^\s*ip\s+route\s+/m.test(text) ||
    /^\s*router\s+ospf\s+\d+/m.test(text);
  // FortiOS/PAN-OS use a different grammar; don't pretend we can read them.
  const looksFortiOrPan = /^\s*config\s+system\s+/m.test(text) || /^\s*set\s+deviceconfig\s+/m.test(text);
  if (looksFortiOrPan) return null;
  return looksCisco ? "cisco-ios" : null;
}

/**
 * The package's main entry point: uploaded config files in, a schema-valid
 * design + advisory findings out.
 *
 * This documents what was uploaded. It never emits a replacement configuration
 * — see findings.ts for the scope rule. Each file's original text is preserved
 * on the returned `devices[].sourceText`.
 */
export function importConfigs(uploads: UploadedConfig[], options: AssembleOptions = {}): ConfigToDesignResult {
  return assembleDesign(parseUploads(uploads), options);
}

/**
 * The parse half of {@link importConfigs}, without assembling or validating a
 * design. Callers that only need the parsed facts — parser-coverage reporting
 * on an already-imported project, for instance — use this rather than paying
 * for a full re-assemble.
 */
export function parseUploads(uploads: UploadedConfig[]): ParsedDevice[] {
  if (uploads.length === 0) {
    throw new UnsupportedConfigError("Upload at least one device configuration file.");
  }

  // One uploaded file may hold several devices (engineers concatenate a whole
  // site, and our own "Download configs" export does exactly that), so each file
  // is split into per-device sections before parsing — see splitDeviceConfigs.
  return uploads.flatMap((upload) => {
    if (upload.text.trim() === "") {
      throw new UnsupportedConfigError(`${upload.name} is empty.`);
    }
    const vendor = detectVendor(upload.text);
    if (vendor !== "cisco-ios") {
      throw new UnsupportedConfigError(
        `${upload.name} doesn't look like a Cisco IOS / IOS-XE configuration. Only Cisco IOS configs can be imported today.`,
      );
    }
    return splitDeviceConfigs(upload.text).map((section) => parseCiscoIosConfig(section, upload.name));
  });
}
