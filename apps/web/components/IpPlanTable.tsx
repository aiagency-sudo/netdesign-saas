import type { ReactNode } from "react";
import type { Design } from "@netdesign/schema";

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return (
    <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
      {children}
    </td>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Renders the IP addressing already present in a validated design JSON — no new data, just a tabular view over segments/devices/interfaces. */
export function IpPlanTable({ design }: { design: Design }) {
  const interfaceRows = design.devices.flatMap((device) =>
    (device.interfaces ?? []).map((iface) => ({
      device: device.hostname ?? device.id,
      interface: iface.name,
      address: iface.ip ?? (iface.trunk ? `Trunk (VLANs: ${(iface.allowedVlans ?? []).join(", ") || "none"})` : "—"),
      description: iface.description ?? "—",
    })),
  );

  return (
    <div className="flex flex-col gap-8">
      <Section title="Segments">
        {design.segments.length === 0 ? (
          <p className="text-sm text-slate-500">No segments defined.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>VLAN ID</Th>
                  <Th>CIDR</Th>
                  <Th>Gateway</Th>
                  <Th>Zone</Th>
                  <Th>Purpose</Th>
                  <Th>DHCP</Th>
                </tr>
              </thead>
              <tbody>
                {design.segments.map((segment) => (
                  <tr key={segment.name}>
                    <Td>{segment.name}</Td>
                    <Td>{segment.vlanId ?? "—"}</Td>
                    <Td>{segment.cidr}</Td>
                    <Td>{segment.gateway ?? "—"}</Td>
                    <Td>{segment.zone ?? "—"}</Td>
                    <Td>{segment.purpose ?? "—"}</Td>
                    <Td>{segment.dhcp === undefined ? "—" : segment.dhcp ? "Yes" : "No"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Device addressing">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>Role</Th>
                <Th>Mgmt IP</Th>
                <Th>Loopback</Th>
                <Th>Zone</Th>
              </tr>
            </thead>
            <tbody>
              {design.devices.map((device) => (
                <tr key={device.id}>
                  <Td>{device.hostname ?? device.id}</Td>
                  <Td>{device.role}</Td>
                  <Td>{device.mgmtIp ?? "—"}</Td>
                  <Td>{device.loopback ?? "—"}</Td>
                  <Td>{device.zone ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Interfaces">
        {interfaceRows.length === 0 ? (
          <p className="text-sm text-slate-500">No interfaces assigned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Device</Th>
                  <Th>Interface</Th>
                  <Th>Address</Th>
                  <Th>Description</Th>
                </tr>
              </thead>
              <tbody>
                {interfaceRows.map((row) => (
                  <tr key={`${row.device}-${row.interface}`}>
                    <Td>{row.device}</Td>
                    <Td>{row.interface}</Td>
                    <Td>{row.address}</Td>
                    <Td>{row.description}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
