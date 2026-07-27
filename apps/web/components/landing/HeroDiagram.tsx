/**
 * A lightweight, static illustration of the kind of role-tiered topology the
 * app produces — internet → firewall → HSRP router pair → access switches.
 * Deliberately hand-drawn SVG (not a live React Flow render) so the hero
 * stays fast and dependency-free; it mirrors the real in-app diagram's tiers
 * and accent colors.
 */
export function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 420 320"
      role="img"
      aria-label="Example network topology: internet, firewall, two redundant routers, two access switches"
      className="h-auto w-full max-w-md"
    >
      {/* links (drawn first, under the nodes) */}
      <g stroke="currentColor" strokeWidth="1.5" className="text-slate-300 dark:text-slate-600">
        <line x1="210" y1="52" x2="210" y2="80" />
        <line x1="210" y1="116" x2="150" y2="150" />
        <line x1="210" y1="116" x2="270" y2="150" />
        <line x1="150" y1="186" x2="130" y2="230" />
        <line x1="270" y1="186" x2="290" y2="230" />
        <line x1="150" y1="168" x2="270" y2="168" strokeDasharray="4 4" />
        <line x1="130" y1="266" x2="290" y2="266" strokeDasharray="4 4" />
      </g>

      {/* internet */}
      <g>
        <ellipse cx="210" cy="30" rx="46" ry="22" className="fill-slate-100 dark:fill-slate-800" stroke="#94a3b8" />
        <text x="210" y="35" textAnchor="middle" className="fill-slate-500 dark:fill-slate-400" fontSize="12">
          Internet
        </text>
      </g>

      {/* firewall */}
      <Node x={168} y={80} w={84} label="fw-01" role="Firewall" accent="#f97316" />

      {/* routers (HSRP pair) */}
      <Node x={108} y={150} w={84} label="rtr-01" role="Router" accent="#6366f1" ha />
      <Node x={228} y={150} w={84} label="rtr-02" role="Router" accent="#6366f1" ha />

      {/* access switches */}
      <Node x={88} y={230} w={84} label="sw-01" role="Switch" accent="#0ea5e9" />
      <Node x={248} y={230} w={84} label="sw-02" role="Switch" accent="#0ea5e9" />
    </svg>
  );
}

function Node({
  x,
  y,
  w,
  label,
  role,
  accent,
  ha,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  role: string;
  accent: string;
  ha?: boolean;
}) {
  const h = 36;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="7"
        className="fill-white stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-600"
        strokeWidth="1"
      />
      <rect x={x} y={y} width="4" height={h} rx="2" fill={accent} />
      <text x={x + 14} y={y + 16} className="fill-slate-900 dark:fill-slate-100" fontSize="11" fontWeight="600">
        {label}
      </text>
      <text x={x + 14} y={y + 28} fill={accent} fontSize="9">
        {role}
      </text>
      {ha && (
        <>
          <rect x={x + w - 24} y={y + 6} width="18" height="12" rx="6" fill={accent} opacity="0.15" />
          <text x={x + w - 15} y={y + 15} textAnchor="middle" fill={accent} fontSize="8" fontWeight="700">
            HA
          </text>
        </>
      )}
    </g>
  );
}
