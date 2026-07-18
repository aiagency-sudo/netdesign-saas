# TODO — NetDesign AI

Read this first each session. Repo is green: `pnpm test` and `pnpm test:golden`
both pass as of the state below.

## Where things stand (after Session 1)

- pnpm workspace scaffolded at the repo root (`pnpm-workspace.yaml`,
  root `package.json` with `build`/`test`/`test:golden`/`typecheck`/`lint`
  scripts, shared `tsconfig.base.json` — strict TS, NodeNext ESM).
- `packages/schema`: `design-schema.json` (moved here from the repo root —
  this package now owns it) + hand-authored zod validators mirroring it
  1:1 (`src/zod/*.ts`, assembled in `src/zod/design.ts`). `parseDesign()` /
  `safeParseDesign()` are the two entry points; `parseDesign()` throws
  `DesignValidationError` with a human-readable per-field message (CLAUDE.md
  hard rule 1: "fail loudly with a human-readable reason"). A
  `schema-drift-guard.test.ts` cross-checks every zod enum and the top-level
  `required` list against the raw JSON schema at test time, so an edit to
  `design-schema.json` that isn't mirrored in the zod schemas fails CI
  immediately instead of drifting silently.
- `packages/design-engine`: first rule module, deterministic IP allocation
  (`src/ip-allocation/`). `SubnetAllocator` is a first-fit, block-aligned
  allocator over one supernet; `planIpAllocation()` uses it in a fixed order
  — mgmt `/24` → loopbacks `/32` (L3-capable roles only) → P2P `/31`s
  (ethernet/fiber/port-channel links between two L3-capable devices only) →
  VLAN segments `/24` (default, overridable per segment). Full rule writeup
  lives in `packages/design-engine/README.md` (the file CLAUDE.md's IP
  addressing rule points at).
- Golden scenario **G1 (branch-office)** is encoded as a fixture
  (`packages/design-engine/test/golden/fixtures/g1-branch-office.ts`) and
  proven overlap-free via `findOverlappingPairs()` in
  `test/golden/g1-branch-office.test.ts`, plus exact-value assertions for
  every mgmt/loopback/P2P/VLAN address. `pnpm test:golden` runs it.
- 42 tests total, all green. No LLM code yet, no vsdx service yet, no app yet.

## Next step (Session 2, per BUILD_PLAN.md)

Build the LLM extraction module: a Claude API call that turns user prose into
design-params JSON (few-shot, 3 examples), then have the design engine
compose a full design JSON for the `branch-office` pattern from those params
(wiring `planIpAllocation` output back into device `mgmtIp`/`loopback`, link
`subnet`, and segment `cidr`/`gateway` fields). Validate the composed output
against `designSchema` from `@netdesign/schema`. Add G1 and G4 as
fixture+snapshot tests for the full prose → design JSON path (not just IP
allocation in isolation, which G1 already covers).

## Notes / decisions made without asking (boring-option calls)

- TS project references + `composite: true` on `packages/schema`, with root
  scripts (`build`/`test`/`typecheck`) always running `build` first — needed
  because `design-engine` imports `DeviceRole`/`LinkKind` types from
  `@netdesign/schema` across the package boundary. Standard pnpm+TS
  monorepo pattern; `dist/` and `*.tsbuildinfo` are gitignored.
- Vitest for tests (fast, native TS, zero-config per package).
- IP allocation is a single shared `SubnetAllocator` instance walked in a
  fixed category order (mgmt, loopback, P2P, VLAN) rather than pre-reserving
  separate blocks per category — simpler, still deterministic, and in
  practice produces contiguous-ish ranges per category for free since
  nothing else has claimed that address space yet. Revisit only if a real
  scenario needs guaranteed contiguous blocks for a specific category.
