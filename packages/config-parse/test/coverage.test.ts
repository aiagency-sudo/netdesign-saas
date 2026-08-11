import { describe, expect, it } from "vitest";
import { fileCoverage } from "../src/coverage.js";
import { parseUploads } from "../src/import.js";

const CLEAN_CONFIG = `!
hostname rtr-01
!
ip routing
!
interface GigabitEthernet0/1
 description Uplink to core
 ip address 10.0.0.1 255.255.255.254
!
end
`;

const CONFIG_WITH_UNKNOWNS = `hostname sw-99
!
interface GigabitEthernet0/1
 switchport mode trunk
 spanning-tree portfast trunk
!
snmp-server community public RO
ntp server 10.0.0.99
`;

describe("fileCoverage", () => {
  it("reports full coverage when every line was recognised", () => {
    const [coverage] = fileCoverage(parseUploads([{ name: "rtr-01.txt", text: CLEAN_CONFIG }]));

    expect(coverage!.name).toBe("rtr-01.txt");
    expect(coverage!.devices).toEqual(["rtr-01"]);
    expect(coverage!.unrecognisedLines).toEqual([]);
    // hostname, ip routing, interface, description, ip address — comments/blanks/end excluded
    expect(coverage!.consideredLines).toBe(5);
  });

  it("lists the exact lines the parser did not understand", () => {
    const [coverage] = fileCoverage(parseUploads([{ name: "sw-99.txt", text: CONFIG_WITH_UNKNOWNS }]));

    expect(coverage!.unrecognisedLines).toEqual([
      "spanning-tree portfast trunk",
      "snmp-server community public RO",
      "ntp server 10.0.0.99",
    ]);
    // hostname, interface, switchport, spanning-tree, snmp-server, ntp
    expect(coverage!.consideredLines).toBe(6);
  });

  it("never counts a line as both recognised and not — unrecognised is a subset of considered", () => {
    const devices = parseUploads([{ name: "sw-99.txt", text: CONFIG_WITH_UNKNOWNS }]);
    for (const device of devices) {
      expect(device.unparsedLines.length).toBeLessThanOrEqual(device.consideredLineCount);
    }
  });

  it("groups a multi-device file under one entry, summing its devices' lines", () => {
    const twoDevices = `${CLEAN_CONFIG}\n${CONFIG_WITH_UNKNOWNS}`;
    const coverage = fileCoverage(parseUploads([{ name: "site.txt", text: twoDevices }]));

    expect(coverage).toHaveLength(1);
    expect(coverage[0]!.devices).toEqual(["rtr-01", "sw-99"]);
    expect(coverage[0]!.unrecognisedLines).toContain("ntp server 10.0.0.99");
  });

  it("keeps one entry per uploaded file", () => {
    const coverage = fileCoverage(
      parseUploads([
        { name: "rtr-01.txt", text: CLEAN_CONFIG },
        { name: "sw-99.txt", text: CONFIG_WITH_UNKNOWNS },
      ]),
    );

    expect(coverage.map((entry) => entry.name)).toEqual(["rtr-01.txt", "sw-99.txt"]);
    expect(coverage[0]!.unrecognisedLines).toEqual([]);
    expect(coverage[1]!.unrecognisedLines.length).toBe(3);
  });
});
