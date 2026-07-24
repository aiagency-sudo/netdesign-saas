import { describe, expect, it } from "vitest";
import { toCiscoInterfaceName } from "../src/interface-naming.js";

describe("toCiscoInterfaceName", () => {
  it("maps vendor-neutral eth0/N to GigabitEthernetN/M", () => {
    expect(toCiscoInterfaceName("eth0/0")).toBe("GigabitEthernet0/0");
    expect(toCiscoInterfaceName("eth0/12")).toBe("GigabitEthernet0/12");
  });

  it("rejects anything that isn't the expected eth<unit>/<port> shape", () => {
    expect(() => toCiscoInterfaceName("GigabitEthernet0/0")).toThrow(/Expected a vendor-neutral interface name/);
    expect(() => toCiscoInterfaceName("eth0")).toThrow(/Expected a vendor-neutral interface name/);
  });
});
