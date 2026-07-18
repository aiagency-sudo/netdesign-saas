# TODO — NetDesign AI

Read this first each session. Repo is green: `pnpm test` / `pnpm test:golden`
/ `pnpm typecheck` (TypeScript workspace, now including `scripts/`) and
`services/vsdx`'s `pytest` (Python, separate venv) both pass as of the
state below.

## Where things stand (after Session 5 — Phase 0 + port-name labels)

- TS workspace unchanged in shape from Session 2: `packages/schema`,
  `packages/design-engine`, `packages/llm-extraction`. 79 tests, all green.
- **`services/vsdx`** (new — first and only place Python is used, per
  CLAUDE.md): a FastAPI service, `POST /export` (design JSON in, `.vsdx`
  bytes out, `Content-Type: application/vnd.ms-visio.drawing`) and
  `GET /healthz`. Own venv at `services/vsdx/.venv`; `pip install -e ".[dev]"`
  then `pytest` (42 tests). Not wired into the pnpm workspace — it's a
  separately-deployed Python service, so it stays outside `pnpm-workspace.yaml`.
  - `app/models.py`: pydantic mirror of `design-schema.json` (Python's
    counterpart to `packages/schema`'s zod validators). Strictly typed for
    devices/links/segments/meta (what this service renders);
    routing/security/cloud are permissive passthrough dicts since nothing
    here reads them. `tests/test_models.py` drift-guards the `Literal` enums
    against the canonical `packages/schema/src/design-schema.json` by
    relative path — same role as `schema-drift-guard.test.ts` on the TS side.
  - `app/vsdx_builder.py`: `build_vsdx_bytes(design)` — one rectangle shape
    per device (fill color by role, `app/colors.py`), grid-laid-out (max 4
    cols, page grows to fit), device id/role/vendor/hostname/mgmtIp/loopback/
    zone embedded as real Visio **Shape Data** (custom properties, not just
    text). One connector per link via `vsdx.Connect.create()`, skipping any
    link with an end outside the device list (`renderable_links()`).
  - `app/templates/blank.vsdx`: checked-in binary template every export
    starts from — `vsdx.VisioFile(path)` can only *open* a file, there's no
    "create blank" API. Derived from vsdx's own bundled `media.vsdx` (its one
    demo shape stripped out) rather than hand-built, because a from-scratch
    minimal OOXML zip is missing pieces `vsdx.Connect.create()` needs when it
    lazily bootstraps the connector master. Regenerate via
    `app/templates/generate_blank_template.py` (only needed if the `vsdx` pin
    changes). See `services/vsdx/README.md` for the full why.
  - `app/structural_validator.py`: `validate_vsdx_structure(bytes, design)` —
    unzips, checks required OOXML parts, and cross-checks shape count
    (`devices + renderable_links`), `<Connect>` count (`2 * renderable_links`),
    and that every device's Shape Data actually matches that device (not
    just that some shape exists). This is NOT the golden-`.vsdx`-file
    comparison CLAUDE.md describes for real-Visio-validated exports — that's
    a Session-4 weekend-gate concern once export *quality* is being judged.
  - Fixed a `vsdx==0.6.1` bug in `_fix_connector_trigger_formulas()`:
    `Connect.create()`'s formula rewrite drops a `.` (`Sheet1!` instead of
    `Sheet.1!`), which wouldn't break vsdx's own round-tripping but likely
    breaks a real Visio's live re-glue tracking.
  - `tests/fixtures/g{1,4}_*.json` are hand-transcribed from the TS
    composer's G1/G4 snapshot output (`packages/design-engine/test/golden/
    __snapshots__/`) — same golden scenarios, both languages, kept in sync
    by eye for now (no automated cross-language sync yet).
  - **Found and fixed two real bugs via the weekend-gate check, mid-session**:
    the founder tried opening the G1 export in draw.io and got "Cannot read
    properties of null (reading 'getElementsByTagName')".
    1. First fix (insufficient on its own): `Connect.create()` re-bootstraps
       the connector master's `[Content_Types].xml` `<Override>` and
       `document.xml.rels` `<Relationship>` entries on *every* call (its
       existence check never holds true in this in-memory-zip flow), so
       G1's 5 links produced 6 duplicate entries for the same masters
       `PartName` — invalid per the OPC spec. Fixed, re-exported, founder
       retried in draw.io — **same error**.
    2. Real root cause: `vsdx` never calls `ET.register_namespace()`, so
       every part it re-serializes (`document.xml`, `page1.xml`, `pages.xml`,
       `pages.xml.rels`) gets Python's auto-generated `ns0:` prefix instead
       of the unprefixed default real Visio uses. draw.io's importer matches
       tags/attributes as bare string literals (`child.tagName ===
       "PageContents"`, confirmed by fetching and reading draw.io's actual
       importer source from GitHub, since this session's network policy
       blocks `app.diagrams.net` itself) — every one of those silently fails
       against a prefixed tag. Fixed with a per-file post-save pass
       (`_repackage()` in `vsdx_builder.py`, replacing the narrower
       `_dedupe_opc_metadata()`) that registers each part's own namespace as
       default immediately before re-serializing *that specific part* — a
       single upfront registration can't work here since
       `ET.register_namespace("", uri)` is a shared global slot and
       `save_vsdx()` writes multiple differently-namespaced parts in one call.
    Both are regression-tested in `structural_validator.py`
    (`_check_opc_metadata_integrity()`, `_check_no_generated_namespace_prefixes()`)
    and `tests/test_structural_validator.py`. Full writeup with the debugging
    trail in `services/vsdx/README.md`. **WEEKEND GATE: all 3 targets
    confirmed clean by the founder** — draw.io, LibreOffice Draw, and real
    Microsoft Visio (via OneDrive's free web viewer, substituting for a
    desktop license per BUILD_PLAN's "(or Visio web viewer)" allowance).
    G1 and G4 both open without errors in all three.
- **`scripts/generate-design.ts`** (new — BUILD_PLAN Session 4's "wire
  engine → vsdx service end-to-end via a CLI script"): `pnpm generate --
  --fixture g1|g4` composes a golden scenario directly (no LLM call, no
  `ANTHROPIC_API_KEY` needed — the params are inlined in the script, not
  imported from test/ code) or `pnpm generate -- --prose "<text>"` runs the
  full `user prose → design-params → design JSON` pipeline via
  `@netdesign/llm-extraction`, then POSTs the result to a running
  `services/vsdx` instance's `/export` and writes the `.vsdx` to disk
  (`--out`; `--design-json-out` to also dump the intermediate JSON).
  Clear, human-readable errors for the two obvious failure modes: vsdx
  service unreachable (with the exact command to start it) and missing
  `ANTHROPIC_API_KEY`. Root `package.json` gained a `dependencies` block
  (workspace packages) and a `tsconfig.json` (so `pnpm typecheck` covers
  `scripts/` too, via `tsc -p tsconfig.json --noEmit` after the per-package
  loop) — first time either was needed at the root. Verified for real:
  started the vsdx service locally, ran both `--fixture g1` and `--fixture
  g4` end-to-end, and confirmed the resulting `.vsdx` files pass
  `validate_vsdx_structure()`. `--prose` wasn't live-tested (no API key in
  this environment) but its error-guard path (missing key, `--prose` +
  `--fixture` both given) was.
- **Port names on the diagram** (founder feedback after reviewing the
  weekend-gate exports: "the drawing doesn't display port names — g1/1,
  eth1/1, etc"):
  - `packages/design-engine/src/compose/branch-office.ts`'s new
    `assignInterfaces()` assigns a vendor-neutral `eth0/N` per device per
    link (sequential in link order — a device's Nth link gets `eth0/N-1`),
    embeds it in `link.a`/`link.b` as `deviceId:interface` (the format
    design-schema.json already documented but nothing produced yet), and
    populates that device's `interfaces[]` with `ip` (P2P links, from
    `planIpAllocation`'s `p2pLinks`) or `trunk`+`allowedVlans` (everything
    else — every VLAN in the design, since there's no per-switch VLAN
    membership model). This also let the stale "interface trunk assignment
    not yet populated" `meta.assumptions` entry get removed — it's populated
    now. Full writeup in `packages/design-engine/README.md`.
  - `services/vsdx/app/vsdx_builder.py`: `_add_port_labels()` adds a small
    borderless text shape near each connector endpoint that has an interface
    name, positioned via `_port_label_position()` (offset from the near
    device toward the far one, clamped to the midpoint on short links —
    pure function, unit-tested directly). Shape IDs use
    `page.set_max_ids() + 1` right before each add, so they can never
    collide with device/connector shapes regardless of what vsdx's own ID
    assignment picked.
  - `structural_validator.py` grew a shape-count adjustment
    (`+ port_label_count`) and a new `_check_port_labels_present()` —
    `Counter`-based (expected occurrences ≤ actual occurrences per text),
    not set membership, because interface names restart per device
    (`eth0/0` legitimately appears once per device across a real design), so
    a naive "does this text exist anywhere on the page" check can't tell a
    genuinely missing label from one of its many same-text siblings.
  - `tests/fixtures/g{1,4}_*.json` (Python) updated to match the new TS
    snapshot output exactly (interface-suffixed links + `interfaces[]`).
  - Verified end-to-end via `pnpm generate -- --fixture g1|g4` against a
    locally running vsdx service; sent both exports to the founder for
    visual confirmation — **confirmed good**, with one bug found on review:
    `sw-02` (rightmost device in G1's grid row) had its `rtr-02`-facing and
    `sw-01`-facing port labels compute to the *exact same coordinate* —
    `_port_label_position()` only considered one link's direction at a
    time, and both of `sw-02`'s links happen to point left (everything else
    in the row is to its left). One label silently hid the other. Fixed by
    passing each interface's own `eth0/N` index into
    `_port_label_position()` and nudging perpendicular to the line by an
    amount that strictly grows with `N` — two labels at the same device can
    no longer land on the same point, regardless of how their directions
    compare. 5 new tests (2 regression tests for the exact bug, 3 for the
    jitter behavior itself); 42 Python tests total. Re-verified end-to-end
    and re-sent both exports — **this second round's founder confirmation
    is what's pending**, not blocking Session 6's start.

## Next step (Session 6, per BUILD_PLAN.md Sessions 5-6)

**Phase 0 is done and port names are shipped.** Founder gave the green
light to start Phase 1: "Build the Next.js app: Supabase auth (email magic
link), projects table, a prompt page that calls the pipeline, and a React
Flow canvas rendering the design JSON with role-based node icons and zone
grouping. Deploy to Vercel; deploy services/vsdx to Railway." This is the
first work in `apps/web` — nothing there yet, first time this repo needs
external service credentials (Supabase, Vercel, Railway) instead of just
local/CI-only tooling.

Still separately open, deliberately not blocking Phase 1: real stencils for
routers/switches/firewalls instead of generic colored rectangles. Leaning
against proprietary Microsoft/Cisco stencils (licensing + the
`Connect.create()` master-copying fragility already seen once), toward
hand-built vendor-neutral vector icon shapes over embedded raster/SVG — but
this is the founder's call, not decided.

## Notes / decisions made without asking (boring-option calls)

- `services/vsdx` is a standalone Python project (own `pyproject.toml`, own
  `.venv`), not part of the pnpm workspace — it's deployed separately per
  CLAUDE.md, so there was never a reason to fold it into the TS tooling.
- Devices only — VLAN/segment shapes are not drawn on the diagram this
  session. The task was "shapes per device role, connectors per link,"
  segments weren't asked for, and adding them would have meant inventing an
  unrequested visual convention (grouping box? separate shape type?)
  without a golden scenario to anchor the decision against.
- Router↔router / redundancy-group visual grouping (e.g. a dashed box around
  an HSRP pair) also not drawn — same reasoning, not asked for, and a real
  design opinion better made once real Visio output has actually been judged
  in the Session-4 weekend gate.
- Shape Data field list (id/role/vendorHint/hostname/mgmtIp/loopback/zone)
  is deliberately a fixed, hand-picked subset of Device's fields, not "every
  field on the device" — `interfaces[]` isn't flattened into shape data
  since it's a list, not a scalar, and doesn't have an obvious single-value
  representation in a custom property.
- `scripts/generate-design.ts`'s G1/G4 presets are copy-pasted from
  `packages/design-engine/test/golden/fixtures/`, not imported — a script
  meant to be run by a human (and to prove the pipeline works from outside
  the test suite) shouldn't depend on test-only code. Accepted the small
  duplication/drift risk over that coupling.
- Root `package.json` needed `@types/node` for the first time (nothing
  before `scripts/` used Node built-ins/`process` in code that TS actually
  type-checked from the repo root — `packages/llm-extraction`'s own
  `process.env` usage typechecks fine standalone because `@types/node`
  comes in transitively via `@anthropic-ai/sdk`'s own dependency tree,
  which isn't visible from the root). Pinned to `^22` to match the Node
  version this environment and Node 22+ deploy targets actually run.
- Interface names are `eth0/N`, uniform across every device role — not
  `Gi0/N`/`port1`/etc. per vendor. design-schema.json's own field
  description says exactly this ("Vendor-neutral: eth0/1 — templates map to
  Gi0/1, port1, ethernet1/1 etc."); vendor-specific naming is config-gen's
  job (not built yet), not the diagram's.
- Every trunk link gets *every* VLAN in `allowedVlans` — there's no
  per-switch VLAN membership model in this composer, so "all VLANs on every
  trunk" is the only answer that doesn't require inventing a policy nobody
  asked for. Revisit if/when per-switch VLAN scoping becomes a real
  requirement.
- Port labels are a fixed-size borderless text shape, not a Visio "Callout"
  or connector-endpoint-native label feature — kept it a plain Shape (same
  primitive already used for devices) rather than researching a more
  Visio-idiomatic mechanism, since the plain-shape approach is understood
  and already proven reliable for this codebase's XML-construction pattern.
