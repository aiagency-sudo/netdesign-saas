# TODO — NetDesign AI

Read this first each session. Repo is green: `pnpm test` and `pnpm test:golden`
both pass as of the state below.

## Where things stand (after Session 2)

- pnpm workspace: `packages/schema`, `packages/design-engine`,
  `packages/llm-extraction`. Root `build`/`test`/`test:golden`/`typecheck`
  always build first (TS project references across the workspace).
- `packages/schema`: `design-schema.json` + zod validators (`designSchema`,
  `parseDesign()`/`safeParseDesign()`, `DesignValidationError`), plus a new
  **`designParamsSchema`** (`src/zod/design-params.ts`) — the intermediate
  contract between LLM extraction and the design-engine composer. It's
  deliberately narrower than the final design schema and its
  `designPattern` enum only allows `"branch-office"` / `"smb-flat"`, the two
  patterns the composer can build today. `schema-drift-guard.test.ts` still
  only guards `designSchema` against `design-schema.json`; `designParamsSchema`
  has no external JSON-schema counterpart so it doesn't need one.
- `packages/design-engine`:
  - `ip-allocation/` unchanged from Session 1 (`SubnetAllocator`,
    `planIpAllocation`), plus a new `findOverlappingSubnetsInDesign(design)`
    in `validate.ts` — the same zero-overlap check as before, but over a
    *composed* Design's mgmt IPs (treated as /32), loopbacks, link subnets,
    and VLAN CIDRs, instead of a raw `IpAllocationPlan`.
  - **`compose/branch-office.ts`** (new): `composeBranchOfficeDesign(params:
    DesignParams): Design`. Builds routers/switches/an optional firewall,
    wires firewall↔router and router↔switch (round-robin when counts don't
    match) and switch↔switch interlink links, assigns VLAN ids sequentially,
    calls `planIpAllocation`, merges addressing back into devices/links/
    segments, and **always returns `parseDesign()`'s validated output or
    throws** — the schema-validation gate lives here per CLAUDE.md hard rule
    1. Despite the name it serves both `branch-office` and `smb-flat`
    params — same topology shape, different device counts; see the doc
    comment on the function for why one composer, not two.
- `packages/llm-extraction` (new package): the Claude API call.
  - `client.ts`: a narrow `ExtractionClient` interface (`createMessage`) so
    everything is testable with a fake client, no network/API key needed in
    tests. `createAnthropicExtractionClient()` is the real implementation,
    lazily importing `@anthropic-ai/sdk` so that import (and the
    `ANTHROPIC_API_KEY` requirement) only bites the code path that actually
    calls Claude.
  - `prompt.ts`: system prompt + **3 few-shot examples** (prose + expected
    tool input, each parsed through `designParamsSchema` at module load so a
    typo fails immediately). The Claude tool's `input_schema` is derived
    from `designParamsSchema` via `zod-to-json-schema` — one source of
    truth, no hand-duplicated JSON schema to drift.
  - `extract.ts`: `extractDesignParams()` forces the tool call
    (`tool_choice`), `parseExtractionResponse()` is split out as a pure,
    client-free function and throws `DesignParamsExtractionError` with a
    human-readable reason (no tool_use block, or validation failure).
  - `generate.ts`: `generateBranchOfficeDesign(prose, { client })` — chains
    extraction → `composeBranchOfficeDesign`. This is the
    `user prose → design-params → design JSON` pipeline CLAUDE.md describes,
    minus the not-yet-built apps/web wiring around it.
  - Model default is `claude-sonnet-5`; override via `{ model }`.
- Golden scenarios **G1** (branch-office: 2 routers HSRP, 2 switches, 1
  firewall, 3 VLANs) and **G4** (smb-flat: 1 router, 1 switch, 1 firewall,
  corp+guest VLANs) now have design-params fixtures
  (`packages/design-engine/test/golden/fixtures/g{1,4}-*-params.ts`) run
  through `composeBranchOfficeDesign` with snapshot tests
  (`compose-g1-branch-office.test.ts`, `compose-g4-smb-simple.test.ts`),
  each also asserting zero subnet overlap and determinism. (G1's original
  ip-allocation-only fixture/test from Session 1 is untouched and still
  passes — it exercises `planIpAllocation` directly, one level down from
  the new composer-level tests.)
- 79 tests total, all green. No apps/web yet, no vsdx service yet.

## Next step (Session 3, per BUILD_PLAN.md)

Create `services/vsdx`: a FastAPI service with `POST /export` taking design
JSON, using the `vsdx` Python library to build a diagram — shapes per device
role, connectors per link, device properties embedded as Visio shape data.
Include a structural validator (unzip the .vsdx, check XML parts) and pytest
coverage. This is the first and only place Python is used in the repo.

## Notes / decisions made without asking (boring-option calls)

- `designParamsSchema` lives in `packages/schema`, not `packages/
  llm-extraction` or `packages/design-engine` — it's the contract between
  those two modules, and `packages/schema` is already "the contract between
  ALL modules" per CLAUDE.md. Avoids a circular dependency (llm-extraction →
  design-engine → schema is fine; schema never depends back on either).
- Anthropic tool input_schema needed a `Tool[]` cast in `client.ts` — the
  SDK's `InputSchema` type wants a narrower literal shape than a plain
  `Record<string, unknown>` JSON-schema-shaped object; the real work of
  keeping that schema correct is delegated to `zod-to-json-schema` +
  `designParamsSchema`, so the cast is just bridging two type
  representations of the same validated-at-runtime object, not a
  correctness risk.
- `composeBranchOfficeDesign` does not yet populate per-device
  `interfaces[]` (trunk/allowedVlans/per-interface IP) — out of scope for
  this session (config-gen, which actually needs that detail, isn't built
  yet). Flagged as a `meta.assumptions` entry in every composed design so
  it's visible, not silently missing.
- Router↔router peer links are intentionally not modeled even when
  `router.count > 1` — HSRP peers over the shared VLAN segment, and the
  Session-1 G1 ip-allocation fixture already established that shape; adding
  a direct P2P peer link would be a design opinion beyond what either
  golden scenario asked for.
- No `apps/web` wiring yet — `generateBranchOfficeDesign()` is a complete,
  tested library function; hooking it to a Next.js API route is Phase 1
  (Sessions 5-6), not this session.
