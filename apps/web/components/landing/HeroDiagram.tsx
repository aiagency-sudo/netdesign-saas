/**
 * Lightweight, static illustrations of the role-tiered topologies the app
 * produces, one per design pattern the engine can actually generate today:
 *
 *  - "branch": internet → firewall → HSRP router pair → access switches
 *  - "campus": three-tier — firewall → L3 core pair → HSRP distribution pair
 *    (the VLAN gateways) → L2 access switches
 *
 * Deliberately hand-drawn SVG (not a live React Flow render) so the hero stays
 * fast and dependency-free. Restrained warm/monochrome palette with mono
 * labels, to sit inside the IDE-style mockup card.
 */
export type HeroVariant = "branch" | "campus";

const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const INK = "#26251e";
const BODY = "#5a5852";
const MUTED = "#807d72";
const HAIRLINE = "#cfcdc4";
const CANVAS_SOFT = "#fafaf7";

export function HeroDiagram({ variant }: { variant: HeroVariant }) {
  return variant === "campus" ? <CampusDiagram /> : <BranchDiagram />;
}

function BranchDiagram() {
  return (
    <svg
      viewBox="0 0 420 320"
      role="img"
      aria-label="Branch-office topology: internet, firewall, two redundant routers, two access switches"
      className="h-auto w-full"
    >
      <g stroke={HAIRLINE} strokeWidth="1.25">
        <line x1="210" y1="52" x2="210" y2="80" />
        <line x1="210" y1="116" x2="150" y2="150" />
        <line x1="210" y1="116" x2="270" y2="150" />
        <line x1="150" y1="186" x2="130" y2="230" />
        <line x1="270" y1="186" x2="290" y2="230" />
        <line x1="150" y1="168" x2="270" y2="168" strokeDasharray="3 4" />
        <line x1="130" y1="266" x2="290" y2="266" strokeDasharray="3 4" />
      </g>

      <Cloud cx={210} cy={30} label="internet" />
      <Node x={168} y={80} w={84} label="fw-01" role="firewall" />
      <Node x={108} y={150} w={84} label="rtr-01" role="router" badge="HA" />
      <Node x={228} y={150} w={84} label="rtr-02" role="router" badge="HA" />
      <Node x={88} y={230} w={84} label="sw-01" role="switch" />
      <Node x={248} y={230} w={84} label="sw-02" role="switch" />
    </svg>
  );
}

function CampusDiagram() {
  return (
    <svg
      viewBox="0 0 420 320"
      role="img"
      aria-label="Campus three-tier topology: firewall, L3 core pair, HSRP distribution pair as VLAN gateways, three access switches each dual-homed to both distribution switches"
      className="h-auto w-full"
    >
      <g stroke={HAIRLINE} strokeWidth="1.25">
        {/* internet -> fw */}
        <line x1="210" y1="42" x2="210" y2="60" />
        {/* fw -> cores */}
        <line x1="210" y1="96" x2="150" y2="120" />
        <line x1="210" y1="96" x2="270" y2="120" />
        {/* core peer link */}
        <line x1="150" y1="138" x2="270" y2="138" strokeDasharray="3 4" />
        {/* cores -> dists (routed L3) */}
        <line x1="150" y1="156" x2="150" y2="192" />
        <line x1="270" y1="156" x2="270" y2="192" />
        <line x1="150" y1="156" x2="270" y2="192" />
        <line x1="270" y1="156" x2="150" y2="192" />
        {/* dist peer (HSRP) */}
        <line x1="150" y1="210" x2="270" y2="210" strokeDasharray="3 4" />
        {/* dists -> access: every access switch dual-homed to BOTH distribution
            switches (L2 trunks; STP selects the root port and blocks the secondary) */}
        <line x1="150" y1="224" x2="90" y2="264" />
        <line x1="150" y1="224" x2="210" y2="264" />
        <line x1="150" y1="224" x2="330" y2="264" />
        <line x1="270" y1="224" x2="90" y2="264" />
        <line x1="270" y1="224" x2="210" y2="264" />
        <line x1="270" y1="224" x2="330" y2="264" />
      </g>

      <Cloud cx={210} cy={24} label="internet" rx={40} ry={17} />
      <Node x={174} y={60} w={72} h={32} label="fw-01" role="firewall" />
      <Node x={114} y={120} w={72} h={32} label="core-01" role="core" />
      <Node x={234} y={120} w={72} h={32} label="core-02" role="core" />
      <Node x={114} y={192} w={72} h={32} label="dist-01" role="distribution" badge="GW" />
      <Node x={234} y={192} w={72} h={32} label="dist-02" role="distribution" badge="GW" />
      <Node x={58} y={264} w={64} h={30} label="acc-01" role="access" />
      <Node x={178} y={264} w={64} h={30} label="acc-02" role="access" />
      <Node x={298} y={264} w={64} h={30} label="acc-03" role="access" />
    </svg>
  );
}

function Cloud({ cx, cy, label, rx = 46, ry = 21 }: { cx: number; cy: number; label: string; rx?: number; ry?: number }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={CANVAS_SOFT} stroke={HAIRLINE} />
      <text x={cx} y={cy + 4} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily={MONO}>
        {label}
      </text>
    </g>
  );
}

function Node({
  x,
  y,
  w,
  h = 36,
  label,
  role,
  badge,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  role: string;
  badge?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill="#ffffff" stroke={HAIRLINE} strokeWidth="1" />
      <text x={x + 12} y={y + 16} fill={INK} fontSize="12" fontFamily={MONO}>
        {label}
      </text>
      <text x={x + 12} y={y + h - 8} fill={BODY} fontSize="9" fontFamily={MONO}>
        {role}
      </text>
      {badge && (
        <>
          <rect x={x + w - 26} y={y + 6} width="20" height="12" rx="6" fill="none" stroke={HAIRLINE} />
          <text x={x + w - 16} y={y + 15} textAnchor="middle" fill={MUTED} fontSize="7" fontFamily={MONO} letterSpacing="0.5">
            {badge}
          </text>
        </>
      )}
    </g>
  );
}
