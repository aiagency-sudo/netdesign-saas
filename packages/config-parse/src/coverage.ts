import type { ParsedDevice } from "./types.js";

/**
 * How much of one uploaded file the parser actually understood.
 *
 * Exists because "we documented your network" is only trustworthy if the gaps
 * are visible too: a config line the parser skipped is a line the diagram, HLD
 * and .vsdx don't reflect. The summary finding (`unparsed-lines`) says how
 * many; this says exactly which, per file, so an engineer can judge whether
 * the missing lines matter.
 */
export interface FileParseCoverage {
  /** Uploaded filename. */
  name: string;
  /** Hostnames parsed out of this file (one file may hold several devices). */
  devices: string[];
  /** Config lines the parser looked at — excludes blanks, `!` comments and `end`. */
  consideredLines: number;
  /** The lines it did not recognise, verbatim (trimmed), in file order. */
  unrecognisedLines: string[];
}

/**
 * Groups parsed devices back into per-file coverage. Grouping is by
 * `sourceName` because a single upload can be split into several devices
 * (engineers concatenate a whole site into one file), and the user thinks in
 * files — that's what they dragged in.
 */
export function fileCoverage(devices: ParsedDevice[]): FileParseCoverage[] {
  const byFile = new Map<string, FileParseCoverage>();

  for (const device of devices) {
    let coverage = byFile.get(device.sourceName);
    if (!coverage) {
      coverage = { name: device.sourceName, devices: [], consideredLines: 0, unrecognisedLines: [] };
      byFile.set(device.sourceName, coverage);
    }
    coverage.devices.push(device.hostname);
    coverage.consideredLines += device.consideredLineCount;
    coverage.unrecognisedLines.push(...device.unparsedLines);
  }

  return [...byFile.values()];
}
