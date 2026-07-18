"""Pydantic mirror of design-schema.json — the Python-side counterpart to
packages/schema's zod validators. Devices/links/segments/meta are typed
strictly since this service renders them; routing/security/cloud are
accepted as permissive passthrough dicts since nothing here reads them yet.

tests/test_models.py cross-checks the Literal enums below against the
canonical packages/schema/src/design-schema.json, the same way
schema-drift-guard.test.ts does on the TypeScript side.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DeviceRole = Literal[
    "router",
    "core-switch",
    "distribution-switch",
    "access-switch",
    "firewall",
    "load-balancer",
    "wireless-controller",
    "access-point",
    "server",
    "cloud-gateway",
    "vpn-concentrator",
    "reverse-proxy",
    "internet",
    "generic",
]

VendorHint = Literal[
    "cisco-ios",
    "cisco-iosxe",
    "cisco-nxos",
    "fortinet-fortigate",
    "paloalto-panos",
    "aruba-aoscx",
    "hpe-comware",
    "arista-eos",
    "f5-tmos",
    "juniper-junos",
    "aws",
    "azure",
    "gcp",
    "generic",
]

LinkKind = Literal["ethernet", "fiber", "port-channel", "wan", "vpn-tunnel", "wireless", "virtual"]

SegmentPurpose = Literal["user", "voice", "guest", "management", "server", "dmz", "transit", "storage", "iot", "other"]


class Interface(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    ip: Optional[str] = None
    vlan: Optional[int] = None
    trunk: Optional[bool] = None
    allowedVlans: Optional[list[int]] = None
    description: Optional[str] = None


class Device(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    hostname: Optional[str] = None
    role: DeviceRole
    vendorHint: VendorHint
    model: Optional[str] = None
    mgmtIp: Optional[str] = None
    loopback: Optional[str] = None
    redundancyGroup: Optional[str] = None
    zone: Optional[str] = None
    interfaces: Optional[list[Interface]] = None


class Link(BaseModel):
    model_config = ConfigDict(extra="allow")

    a: str
    b: str
    kind: Optional[LinkKind] = None
    subnet: Optional[str] = None
    label: Optional[str] = None


class Segment(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    vlanId: Optional[int] = Field(default=None, ge=1, le=4094)
    cidr: str
    gateway: Optional[str] = None
    zone: Optional[str] = None
    purpose: Optional[SegmentPurpose] = None
    dhcp: Optional[bool] = None


class Meta(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    intentSummary: str
    designPattern: Optional[str] = None
    assumptions: Optional[list[str]] = None
    warnings: Optional[list[str]] = None


class Design(BaseModel):
    """The subset of design-schema.json this service actually renders.

    routing/security/cloud are intentionally untyped passthroughs — this
    service doesn't draw them onto the diagram yet, so validating their
    internal shape here would just be dead weight to keep in sync.
    """

    model_config = ConfigDict(extra="allow")

    version: Literal["1.0"]
    meta: Meta
    devices: list[Device] = Field(min_length=1)
    links: list[Link] = Field(default_factory=list)
    segments: list[Segment] = Field(default_factory=list)
    routing: Optional[dict[str, Any]] = None
    security: Optional[dict[str, Any]] = None
    cloud: Optional[dict[str, Any]] = None
