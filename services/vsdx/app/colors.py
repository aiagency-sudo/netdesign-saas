"""Fill color per device role — the only per-role visual differentiation
this session implements. Distinct master stencils per role are a Session-4+
export-quality concern (CLAUDE.md's weekend gate), not this one.
"""

from app.models import DeviceRole

ROLE_COLORS: dict[DeviceRole, str] = {
    "router": "#ADD8E6",  # light blue
    "core-switch": "#90EE90",  # light green
    "distribution-switch": "#90EE90",
    "access-switch": "#C1F0C1",
    "firewall": "#F08080",  # light coral
    "load-balancer": "#DDA0DD",  # plum
    "wireless-controller": "#87CEEB",  # sky blue
    "access-point": "#B0E0E6",  # powder blue
    "server": "#D3D3D3",  # light gray
    "cloud-gateway": "#FFE4B5",  # moccasin
    "vpn-concentrator": "#FFDAB9",  # peach puff
    "reverse-proxy": "#FFFACD",  # lemon chiffon
    "internet": "#FFFFFF",  # white
    "generic": "#E0E0E0",
}

DEFAULT_FILL_COLOR = "#E0E0E0"


def fill_color_for_role(role: str) -> str:
    return ROLE_COLORS.get(role, DEFAULT_FILL_COLOR)  # type: ignore[arg-type]
