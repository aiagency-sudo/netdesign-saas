import { toCidr } from "./ip.js";
import type { ParsedDevice, ParsedHsrp, ParsedInterface, ParsedOspf, ParsedStaticRoute, ParsedVlan } from "./types.js";

/**
 * Splits one uploaded file into per-device configuration sections.
 *
 * Engineers routinely keep several devices in a single file — and our own
 * "Download configs" export concatenates a whole site that way, separated by
 * `! Device: <id>` banners — so treating a file as exactly one device silently
 * merged every device into one: each `hostname` overwrote the last and all the
 * interfaces piled onto a single phantom device.
 *
 * A top-level `hostname` statement is the boundary: an IOS config has exactly
 * one, so N of them means N devices. Any comment/blank lines immediately above
 * a hostname (the banner introducing it) are kept with the device they
 * introduce. A file with zero or one hostname is returned unchanged.
 */
export function splitDeviceConfigs(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const hostnameLines: number[] = [];
  lines.forEach((line, index) => {
    if (/^\s*hostname\s+\S+\s*$/.test(line)) hostnameLines.push(index);
  });

  if (hostnameLines.length <= 1) return [text];

  const sections: string[] = [];
  for (const [position, hostnameLine] of hostnameLines.entries()) {
    // First section keeps any file preamble; later ones start at their banner.
    let start = position === 0 ? 0 : hostnameLine;
    if (position > 0) {
      const floor = hostnameLines[position - 1]! + 1;
      while (start > floor) {
        const previous = lines[start - 1]!.trim();
        if (previous !== "" && !previous.startsWith("!")) break;
        start--;
      }
    }
    const end = position === hostnameLines.length - 1 ? lines.length : hostnameLines[position + 1]!;
    sections.push(lines.slice(start, end).join("\n"));
  }

  // Re-slice so each section ends where the next begins (the loop above uses the
  // next hostname as the end bound, which can duplicate a trailing banner).
  return sections.map((section, index) =>
    index < sections.length - 1 ? trimTrailingBanner(section) : section,
  );
}

/** Drops trailing comment/blank lines so a following device's banner isn't duplicated into this section. */
function trimTrailingBanner(section: string): string {
  const lines = section.split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!.trim();
    if (line !== "" && !line.startsWith("!")) break;
    end--;
  }
  return lines.slice(0, end).join("\n");
}

/**
 * Parses a cisco-ios / ios-xe running-config into {@link ParsedDevice} facts.
 *
 * Deliberately a plain deterministic parser, not an LLM: interfaces, addresses,
 * VLANs, HSRP and OSPF are all regular grammar, so parsing them is exact and
 * reproducible — the same property the design engine gives IP allocation. The
 * uploaded text is preserved verbatim on `sourceText`; this function only
 * READS. Lines it doesn't recognise go to `unparsedLines` rather than being
 * dropped, so the report can tell the user what wasn't understood.
 *
 * Indentation is not relied on (configs get reformatted in transit); block
 * membership is tracked by the last top-level `interface` / `router ospf`
 * header seen, which is how IOS configs are actually structured.
 */
export function parseCiscoIosConfig(text: string, sourceName = "config.txt"): ParsedDevice {
  const device: ParsedDevice = {
    hostname: "",
    vendorHint: "cisco-ios",
    interfaces: [],
    vlans: [],
    staticRoutes: [],
    ipRoutingEnabled: false,
    unparsedLines: [],
    sourceText: text,
    sourceName,
  };

  let currentInterface: ParsedInterface | null = null;
  let currentVlan: ParsedVlan | null = null;
  let ospf: ParsedOspf | null = null;

  const endBlocks = () => {
    currentInterface = null;
    currentVlan = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line === "!" || line === "end" || line.startsWith("!")) continue;

    // --- top-level statements that close any open block ---
    const hostname = /^hostname\s+(\S+)$/.exec(line);
    if (hostname) {
      device.hostname = hostname[1]!;
      endBlocks();
      continue;
    }

    if (/^ip\s+routing$/.test(line)) {
      device.ipRoutingEnabled = true;
      endBlocks();
      continue;
    }

    const staticRoute = /^ip\s+route\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (staticRoute) {
      device.staticRoutes.push({
        prefix: staticRoute[1]!,
        netmask: staticRoute[2]!,
        nextHop: staticRoute[3]!,
      } satisfies ParsedStaticRoute);
      endBlocks();
      continue;
    }

    const interfaceHeader = /^interface\s+(\S+)$/.exec(line);
    if (interfaceHeader) {
      const name = interfaceHeader[1]!;
      currentInterface = { name, shutdown: false, trunk: false };
      const svi = /^Vlan(\d+)$/i.exec(name);
      if (svi) currentInterface.sviVlanId = Number(svi[1]);
      device.interfaces.push(currentInterface);
      currentVlan = null;
      continue;
    }

    // `vlan 10` (VLAN database). Guarded against `vlan` inside an interface block.
    const vlanHeader = /^vlan\s+(\d+)$/.exec(line);
    if (vlanHeader && !currentInterface) {
      currentVlan = { id: Number(vlanHeader[1]) };
      device.vlans.push(currentVlan);
      continue;
    }

    const ospfHeader = /^router\s+ospf\s+(\d+)$/.exec(line);
    if (ospfHeader) {
      ospf = { processId: Number(ospfHeader[1]), networks: [], passiveInterfaces: [], defaultInformationOriginate: false };
      device.ospf = ospf;
      endBlocks();
      continue;
    }

    // --- lines belonging to the open block ---
    if (currentVlan) {
      const vlanName = /^name\s+(\S+)$/.exec(line);
      if (vlanName) {
        currentVlan.name = vlanName[1]!;
        continue;
      }
    }

    if (currentInterface) {
      if (consumeInterfaceLine(currentInterface, line)) continue;
    }

    if (ospf && !currentInterface) {
      if (consumeOspfLine(ospf, line)) continue;
    }

    device.unparsedLines.push(line);
  }

  if (!device.hostname) {
    // No `hostname` in the file — fall back to the filename rather than inventing one.
    device.hostname = sourceName.replace(/\.(txt|cfg|conf|log)$/i, "");
  }

  return device;
}

/** Returns true when the line was recognised as belonging to the interface block. */
function consumeInterfaceLine(iface: ParsedInterface, line: string): boolean {
  const description = /^description\s+(.+)$/.exec(line);
  if (description) {
    iface.description = description[1]!.trim();
    return true;
  }

  // `ip address 10.0.1.1 255.255.255.0` (ignores a trailing `secondary`).
  const ipAddress = /^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)/.exec(line);
  if (ipAddress) {
    const cidr = toCidr(ipAddress[1]!, ipAddress[2]!);
    if (cidr) iface.ip = cidr;
    return true;
  }

  if (/^no\s+ip\s+address$/.test(line)) return true;
  if (/^no\s+switchport$/.test(line)) return true;
  if (/^no\s+shutdown$/.test(line)) {
    iface.shutdown = false;
    return true;
  }
  if (/^shutdown$/.test(line)) {
    iface.shutdown = true;
    return true;
  }

  if (/^switchport\s+mode\s+trunk$/.test(line)) {
    iface.trunk = true;
    return true;
  }
  if (/^switchport\s+trunk\s+encapsulation\s+\S+$/.test(line)) return true;

  const allowed = /^switchport\s+trunk\s+allowed\s+vlan\s+(?:add\s+)?(\S+)$/.exec(line);
  if (allowed) {
    const vlans = parseVlanList(allowed[1]!);
    iface.allowedVlans = [...(iface.allowedVlans ?? []), ...vlans];
    return true;
  }

  const accessVlan = /^switchport\s+access\s+vlan\s+(\d+)$/.exec(line);
  if (accessVlan) {
    iface.accessVlan = Number(accessVlan[1]);
    return true;
  }
  if (/^switchport\s+mode\s+access$/.test(line)) return true;

  const encapsulation = /^encapsulation\s+dot1[qQ]\s+(\d+)/.exec(line);
  if (encapsulation) {
    iface.encapsulationVlanId = Number(encapsulation[1]);
    return true;
  }

  const standby = /^standby\s+(\d+)\s+(.+)$/.exec(line);
  if (standby) {
    const group = Number(standby[1]);
    const rest = standby[2]!.trim();
    const hsrp: ParsedHsrp = iface.hsrp ?? { group, preempt: false };
    hsrp.group = group;

    const virtualIp = /^ip\s+(\d+\.\d+\.\d+\.\d+)$/.exec(rest);
    if (virtualIp) hsrp.virtualIp = virtualIp[1]!;
    const priority = /^priority\s+(\d+)$/.exec(rest);
    if (priority) hsrp.priority = Number(priority[1]);
    if (/^preempt$/.test(rest)) hsrp.preempt = true;

    iface.hsrp = hsrp;
    return true;
  }

  return false;
}

/** Returns true when the line was recognised as belonging to the `router ospf` block. */
function consumeOspfLine(ospf: ParsedOspf, line: string): boolean {
  const network = /^network\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+area\s+(\S+)$/.exec(line);
  if (network) {
    ospf.networks.push({ network: network[1]!, wildcard: network[2]!, area: network[3]! });
    return true;
  }

  const passive = /^passive-interface\s+(\S+)$/.exec(line);
  if (passive) {
    ospf.passiveInterfaces.push(passive[1]!);
    return true;
  }

  if (/^default-information\s+originate/.test(line)) {
    ospf.defaultInformationOriginate = true;
    return true;
  }

  return false;
}

/** Expands an IOS VLAN list ("10,20,30" or "10-12,20") into explicit ids. */
export function parseVlanList(value: string): number[] {
  const ids: number[] = [];
  for (const part of value.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part.trim());
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let id = from; id <= to; id++) ids.push(id);
      continue;
    }
    const single = /^\d+$/.exec(part.trim());
    if (single) ids.push(Number(part.trim()));
  }
  return ids;
}
