# packages/design-engine

Deterministic rules that turn LLM-extracted design parameters into a
schema-valid design JSON. No LLM math — everything here is pure functions
over the shapes defined in `@netdesign/schema`.

## IP allocation rules (`src/ip-allocation/`)

Every design has one `siteSupernet` (e.g. `10.20.0.0/16`). All addressing for
that site is carved out of it by a single `SubnetAllocator`
(`src/ip-allocation/allocator.ts`): a first-fit, block-aligned allocator that
checks each new block against every block already handed out, so two
allocations can never overlap — this is the enforcement mechanism behind
CLAUDE.md's "no overlapping subnets, ever."

`planIpAllocation()` (`src/ip-allocation/plan.ts`) draws from that shared
allocator in a fixed order:

1. **Management network** — one `/24` by default (`mgmtPrefixLength`
   override available for larger sites). First host is the gateway; devices
   get the following host addresses in input order.
2. **Loopbacks** — one `/32` per device whose `role` is L3-capable
   (`router`, `core-switch`, `distribution-switch`, `firewall`,
   `load-balancer`, `vpn-concentrator`, `cloud-gateway`, `reverse-proxy`).
   Access switches and access points are L2-only and never get a loopback.
3. **Point-to-point links** — one `/31` per link where **both** endpoints
   are L3-capable devices and the link `kind` is `ethernet`, `fiber`, or
   `port-channel`. A router-to-access-switch trunk does *not* get a routed
   subnet here — that traffic rides VLAN segments instead. Links to
   something outside the device list (e.g. `internet`) are skipped; `wan`,
   `vpn-tunnel`, `wireless`, and `virtual` links are never P2P-subnetted by
   this rule.
4. **VLAN / user segments** — one block per segment, `/24` by default,
   overridable per segment. First host is the gateway.

Because each category is allocated in full before the next begins, and the
allocator is first-fit ascending, the categories land as contiguous-ish
ranges within the supernet even though nothing forces that explicitly — it
falls out of allocation order.

### Why "deterministic" matters here

Given the same `siteSupernet`, device list, link list, and segment list (in
the same order), `planIpAllocation()` always returns the exact same
addresses. That determinism is what lets the config-gen templates, the vsdx
exporter, and re-generation/versioning all agree on addressing without
talking to each other or to the LLM.

### Extending this module

- New device roles that terminate L3 (e.g. a new SD-WAN edge role) must be
  added to `L3_CAPABLE_ROLES` in `plan.ts` — that single set drives both
  loopback eligibility and P2P link eligibility.
- Redundancy patterns (HSRP/VRRP virtual IPs, HA pairs) are a separate rule
  module, not yet built — they will consume segment gateways from this
  module rather than reimplementing address math.
- `findOverlappingPairs()` (`src/ip-allocation/validate.ts`) is the generic
  overlap check; golden-scenario tests use it directly instead of
  hand-rolling range comparisons.

## Interface naming (`src/compose/branch-office.ts`, `assignInterfaces()`)

Every link endpoint gets a vendor-neutral interface name — `eth0/0`,
`eth0/1`, ... — assigned per device, sequential in link order (a device's
first link gets `eth0/0`, its second gets `eth0/1`, regardless of which
other device is on the other end). Names are embedded directly in the
design's `link.a`/`link.b` as `deviceId:interface` (design-schema.json's
documented format) and mirrored into that device's `interfaces[]`, which
also carries whichever of `ip` (P2P links, from `planIpAllocation`'s
`p2pLinks`) or `trunk`/`allowedVlans` (everything else — router↔switch
trunks, switch↔switch interlinks) applies. There's no per-switch VLAN
membership model yet, so every trunk gets *every* VLAN in the design; that's
the only consistent answer available today, not a considered policy choice.

This is what lets `services/vsdx` label each end of a connector with its
actual port name instead of drawing an unlabeled line — the diagram reads
the interface name straight off `link.a`/`link.b`, it doesn't recompute
anything.
