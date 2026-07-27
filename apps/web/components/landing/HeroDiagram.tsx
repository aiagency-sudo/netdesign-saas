/**
 * A lightweight, static illustration of the kind of role-tiered topology the
 * app produces — internet → firewall → HSRP router pair → access switches.
 * Deliberately hand-drawn SVG (not a live React Flow render) so the hero
 * stays fast and dependency-free. Rendered in a restrained warm/monochrome
 * palette with mono labels, to sit inside the IDE-style mockup card.
 */
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const INK = "#26251e";
const BODY = "#5a5852";
const MUTED = "#807d72";
const HAIRLINE = "#cfcdc4";
const CANVAS_SOFT = "#fafaf7";

export function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 420 320"
      role="img"
      aria-label="Example network topology: internet, firewall, two redundant routers, two access switches"
      className="h-auto w-full"
    >
      {/* links (drawn first, under the nodes) */}
      <g stroke={HAIRLINE} strokeWidth="1.25">
        <line x1="210" y1="52" x2="210" y2="80" />
        <line x1="210" y1="116" x2="150" y2="150" />
        <line x1="210" y1="116" x2="270" y2="150" />
        <line x1="150" y1="186" x2="130" y2="230" />
        <line x1="270" y1="186" x2="290" y2="230" />
        <line x1="150" y1="168" x2="270" y2="168" strokeDasharray="3 4" />
        <line x1="130" y1="266" x2="290" y2="266" strokeDasharray="3 4" />
      </g>

      {/* internet */}
      <g>
        <ellipse cx="210" cy="30" rx="46" ry="21" fill={CANVAS_SOFT} stroke={HAIRLINE} />
        <text x="210" y="34" textAnchor="middle" fill={MUTED} fontSize="11" fontFamily={MONO}>
          internet
        </text>
      </g>

      <Node x={168} y={80} w={84} label="fw-01" role="firewall" />
      <Node x={108} y={150} w={84} label="rtr-01" role="router" ha />
      <Node x={228} y={150} w={84} label="rtr-02" role="router" ha />
      <Node x={88} y={230} w={84} label="sw-01" role="switch" />
      <Node x={248} y={230} w={84} label="sw-02" role="switch" />
    </svg>
  );
}

function Node({ x, y, w, label, role, ha }: { x: number; y: number; w: number; label: string; role: string; ha?: boolean }) {
  const h = 36;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill="#ffffff" stroke={HAIRLINE} strokeWidth="1" />
      <text x={x + 12} y={y + 16} fill={INK} fontSize="12" fontFamily={MONO}>
        {label}
      </text>
      <text x={x + 12} y={y + 28} fill={BODY} fontSize="9" fontFamily={MONO}>
        {role}
      </text>
      {ha && (
        <>
          <rect x={x + w - 26} y={y + 6} width="20" height="12" rx="6" fill="none" stroke={HAIRLINE} />
          <text x={x + w - 16} y={y + 15} textAnchor="middle" fill={MUTED} fontSize="7" fontFamily={MONO} letterSpacing="0.5">
            HA
          </text>
        </>
      )}
    </g>
  );
}
