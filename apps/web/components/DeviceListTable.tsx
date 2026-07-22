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

/** General device inventory — role/vendor/model/redundancy, not addressing (that's the IP Plan tab). */
export function DeviceListTable({ design }: { design: Design }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th>Device</Th>
            <Th>Role</Th>
            <Th>Vendor</Th>
            <Th>Model</Th>
            <Th>Redundancy Group</Th>
            <Th>Zone</Th>
          </tr>
        </thead>
        <tbody>
          {design.devices.map((device) => (
            <tr key={device.id}>
              <Td>{device.hostname ?? device.id}</Td>
              <Td>{device.role}</Td>
              <Td>{device.vendorHint}</Td>
              <Td>{device.model ?? "—"}</Td>
              <Td>{device.redundancyGroup ?? "—"}</Td>
              <Td>{device.zone ?? "—"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
