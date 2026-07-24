# TODO — NetDesign AI

Read this first each session. Repo is green: `pnpm test` / `pnpm test:golden`
/ `pnpm typecheck` / `pnpm --filter @netdesign/web run lint` (TypeScript
workspace, now including `apps/web` and `scripts/`) and `services/vsdx`'s
`pytest` (Python, separate venv) both pass as of the state below.

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

## Where things stand (after Session 6 — apps/web scaffolded)

**Phase 1 built**: `apps/web`, a Next.js 16 (App Router, TypeScript strict)
app, new pnpm workspace member. Built entirely against placeholder env vars
per the founder's explicit call ("no accounts yet — build first") — no
Supabase/Vercel/Railway credentials exist anywhere in this repo or
environment; everything below is verified via build/typecheck/lint/local
`next dev`, not against a real backend.

- **Auth (Supabase magic link, owner-only — no roles/teams per CLAUDE.md's
  scope guard)**: `lib/supabase/{client,server,middleware,env,types}.ts`
  following Supabase's current SSR pattern (`getAll`/`setAll` cookie
  adapters, `@supabase/ssr`). `app/login/page.tsx` (email input ->
  `signInWithOtp`), `app/auth/callback/route.ts` (exchanges the magic-link
  `code` for a session). Route gating lives in `proxy.ts` (Next.js 16
  renamed the `middleware.ts` convention to `proxy.ts` — the old name still
  works but is deprecated with a build warning, so this repo uses the new
  name from the start) + `lib/supabase/middleware.ts`'s `updateSession()`:
  unauthenticated requests to anything but `/`, `/login`, `/auth/callback`
  redirect to `/login`; authenticated requests to `/login` redirect to
  `/projects`. `lib/supabase/types.ts`'s `Database` type includes empty
  `Views`/`Functions`/`Enums`/`CompositeTypes` — recent `@supabase/supabase-js`
  needs the full shape or query builder methods like `.insert()` silently
  degrade to `never` and the whole call site stops typechecking usefully.
- **`supabase/migrations/0001_init.sql`**: one table, `public.projects`
  (`owner_id` FK to `auth.users`, `name`, `prompt`, `design_json jsonb`,
  timestamps + an `updated_at` trigger). RLS on, four owner-only policies
  (select/insert/update/delete all gated on `auth.uid() = owner_id`) — no
  service-role key needed anywhere in `apps/web`, every DB call rides the
  logged-in user's session and RLS does the enforcement. Deliberately no
  versioning/history table yet (BUILD_PLAN Sessions 7-8 territory).
- **`app/api/generate/route.ts`**: the actual pipeline wiring. Auth-gates
  on the session user, 503s cleanly if `ANTHROPIC_API_KEY` isn't set,
  validates the request body with zod, then just calls
  `generateBranchOfficeDesign()` from `@netdesign/llm-extraction` (already
  built in Session 2 — this route adds zero new pipeline logic, only
  auth + persistence around it) and inserts the result into `projects`.
  `DesignParamsExtractionError`/`DesignValidationError` map to `422` with
  the underlying human-readable message; anything else is a `500`.
- **Pages**: `app/projects/page.tsx` (list, server component, relies on RLS
  to scope the query), `app/projects/new/page.tsx` (client component, the
  prompt textarea, POSTs to `/api/generate`, redirects to the new
  project), `app/projects/[id]/page.tsx` (server component, Next 16's
  `params` is now `Promise`-typed — awaited before use — fetches the row
  and hands `design_json` to `DesignCanvas`).
- **React Flow canvas** (`@xyflow/react` — the actively maintained
  successor package; plain `reactflow` is in maintenance mode now):
  `lib/design-to-flow.ts` is a pure `Design -> {nodes, edges}` function
  (unit-testable, no test written yet — see below), grouping devices into
  one `zone`-type group node per distinct `device.zone` (devices with no
  zone share an "Ungrouped" group) with a wrapping grid layout inside each
  zone and zones placed left-to-right; `components/flow/DeviceNode.tsx`
  renders each device with a role-based icon
  (`components/flow/device-icons.tsx`, `lucide-react`, one icon per
  `DeviceRole` enum value) and hostname/role text; edges get a label built
  from both ends' interface names (`rtr-01:eth0/0` -> shows `eth0/0` on
  that end), reusing the port-name data the design-engine already
  populates — no new data needed for this.
- Tailwind v4 (CSS-first config, no `tailwind.config.ts` — just
  `@import "tailwindcss"` in `app/globals.css` + `@tailwindcss/postcss` in
  `postcss.config.mjs`), ESLint 9 flat config using `eslint-config-next`'s
  native flat-config export directly (its `FlatCompat`-wrapped legacy
  strings like `"next/core-web-vitals"` threw a circular-JSON crash under
  this exact eslint-config-next/eslint/eslint-plugin-react version
  combination — switched to `import nextConfig from "eslint-config-next"`
  instead of chasing the incompatibility further).
- **Verified**: `pnpm run build` (all 4 TS packages + `next build`),
  `pnpm run typecheck`, `pnpm run test` (existing 84 tests, apps/web has no
  test script yet so it's skipped, not failing), `pnpm --filter
  @netdesign/web run lint` (clean), and a real `next dev` smoke test
  against placeholder Supabase env vars: `/` redirects to `/login` (307),
  `/login` renders real content, `/projects` correctly redirects
  unauthenticated requests back to `/login` — the full auth-gate flow
  works end-to-end even though no real Supabase project exists yet
  (`getUser()` fails closed on an unreachable Supabase URL rather than
  throwing). **Not verified**: the actual magic-link email round-trip, the
  `/api/generate` route against a live Claude call, or the
  `DesignCanvas`/React Flow rendering with real data — none of that is
  possible without real credentials, which the founder explicitly deferred.
- **Deploy config prepared, not executed** (no accounts exist to deploy
  to): `apps/web/.env.example` documents all four env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `ANTHROPIC_API_KEY`, `VSDX_SERVICE_URL`). Vercel needs no config file for
  a pnpm-workspace monorepo — just set the project's Root Directory to
  `apps/web` in the dashboard and it autodetects the rest; noting that here
  since there's no vercel.json to point to. `services/vsdx/railway.json`
  sets the Nixpacks build (`pip install -e .`) and start
  (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`) commands plus a
  `/healthz` healthcheck.

**Push note (resolved)**: this session's git-proxy was initially read-only
and the GitHub App had no installation on this repo (403s on both `git
push` and the GitHub MCP tools) — fixed by installing the Claude GitHub
App on `aiagency-sudo` with access to `netdesign-saas`. A plain `git push`
then worked and carried the full commit history, including the properly
regenerated `pnpm-lock.yaml` (an earlier `push_files` workaround attempt
had excluded it for size reasons, but that was superseded once `git push`
itself started working) — no `pnpm install` catch-up needed.

## Phase 1 (BUILD_PLAN Sessions 5-6) — CLOSED OUT

`apps/web` deployed to Vercel, PR merged to `main`, Supabase migration run
against the real project, magic-link auth working end-to-end (after
fixing two real deploy issues below), and **the founder ran a real
prompt-to-design generation live in production** — "two redundant routers
with HSRP, two access switches, a firewall, three VLANs" produced a
schema-valid Branch Office design, saved to Supabase, and rendered
correctly in the React Flow canvas (devices, role icons, zone grouping,
interface-labeled edges). This is the first confirmed real-world proof
that the full pipeline (Claude extraction → design-engine composition →
schema validation → persistence → canvas render) works outside local
dev/tests.

Two real deploy bugs found and fixed getting here:
1. **Vercel build failure** ("Module not found: Can't resolve
   '@netdesign/schema'") — Vercel (Root Directory: `apps/web`) only runs
   `apps/web`'s own `build` script, not the root script that builds
   `packages/schema`/`design-engine`/`llm-extraction` to `dist/` first.
   Fixed by changing `apps/web/package.json`'s `build` script to
   `pnpm --filter @netdesign/web^... run build && next build` — builds
   every workspace dependency before `next build`, so the app is buildable
   standalone from its own directory exactly as Vercel invokes it.
2. **Supabase magic link `otp_expired` + wrong redirect domain** — Site
   URL was still the Supabase default `http://localhost:3000`, so a
   redirect that didn't resolve cleanly fell back to localhost (dead,
   from a deployed app); separately, the link failed OTP validation
   outright, most likely a corporate email security scanner/link
   prefetcher consuming the single-use token before the founder's manual
   click. Fixed by setting Site URL to the real Vercel domain and
   confirming the exact `/auth/callback` redirect URL is in the allow
   list; resolved on retry.

Founder feedback on the first real render, verbatim: diagram connections
"don't look all that great" — unclear how the access switches connect to
the router and to each other — and it "doesn't depict the VLANs and
subnet IP Addresses." Both are real gaps, not bugs: the canvas today only
draws devices + interface-labeled edges (Session 5-6's literal scope);
segments/VLANs were explicitly out of scope until now. Directly informs
Session 7-8 scoping below.

## Phase 1 (BUILD_PLAN Sessions 7-8) — CLOSED OUT

> "Add the design detail view: interactive diagram + tabbed panels for IP
> Plan (table from segments/links), Device List, and Assumptions. Add
> Download .vsdx. Add design versioning: each regenerate saves a new
> version row; list + restore."

All four items shipped and merged, worked one at a time per the
founder's explicit "step by step" instruction. Confirmed live: the
founder tried an out-of-scope prompt (a full core/distribution/access
three-tier campus design with dual firewalls) via Regenerate — the
system correctly recognized this doesn't match either supported pattern
(`branch-office`/`smb-flat`) and recorded an honest assumption about the
simplification instead of silently guessing wrong. Founder chose to hold
off on building real campus/three-tier support (a real new
`design-engine` composer + `designParamsSchema` pattern — schema already
has the device roles, so it's collector/composer work, not schema work)
and continue down BUILD_PLAN's literal path instead.

1. **IP Plan tab** — DONE. `IpPlanTable.tsx` renders segments
   (VLAN/CIDR/gateway/purpose/DHCP), device addressing (mgmt IP,
   loopback, zone), and a flattened interface list (P2P `/31` addresses,
   or "Trunk (VLANs: ...)"). Pure frontend, no schema/DB changes.
2. **Device List + Assumptions tabs** — DONE. `DeviceListTable.tsx`
   (role/vendor/model/redundancy group/zone — general inventory,
   distinct from IP Plan's addressing focus) and `AssumptionsList.tsx`
   (`meta.intentSummary`, `meta.assumptions[]`, `meta.warnings[]` when
   present). `ProjectTabs.tsx` now drives all four tabs
   (Diagram/IP Plan/Device List/Assumptions) off one `TABS` array.
3. **Download .vsdx** — DONE and confirmed live. Deployed `services/vsdx`
   to Railway (founder self-served through a Root-Directory hiccup — the
   service initially auto-detected and built `apps/web` instead until
   Root Directory was set to `services/vsdx`), added `VSDX_SERVICE_URL` to
   Vercel, and the "Download .vsdx" button on a real project produced a
   real `.vsdx` file. Founder correctly noted the downloaded file only has
   the diagram, not IP Plan/Device List/Assumptions content — confirmed
   as expected (`.vsdx` = topology only, always was scoped that way; a
   future HLD/LLD `.docx` document, BUILD_PLAN Session 9, is the right
   place for tabular/text content, not the Visio file).
4. **Design versioning** — DONE (code side; not yet run against the real
   Supabase project). `supabase/migrations/0002_project_versions.sql`
   adds an append-only `project_versions` table (`project_id`,
   `design_json`, `prompt`, `created_at`) plus `projects.current_version_id`
   — `projects.design_json`/`prompt` stay a denormalized copy of whichever
   version is current, so every existing read site (`DesignCanvas`,
   `IpPlanTable`, the export route) needed zero changes. RLS on
   `project_versions` checks ownership via a join back to
   `projects.owner_id` (no `owner_id` column on the versions table
   itself). Since real projects already exist in production, the
   migration **backfills** every existing project's `design_json` as its
   version 1 and sets `current_version_id` accordingly — verified for
   real: installed a local Postgres 16 in this sandbox, stubbed a minimal
   `auth.users`/`auth.uid()`, ran `0001_init.sql` then seeded one project
   with a design and one without (mimicking a design mid-generation),
   ran `0002_project_versions.sql`, and confirmed by query: the
   with-design project got exactly one version row with matching prompt
   and a correctly-set `current_version_id`; the without-design project
   was safely skipped (no crash, no bogus empty version). Also confirmed
   the actual data-mutating statements are idempotent (re-running inserted
   zero further rows) — the `CREATE POLICY` statements aren't (expected;
   migrations run once, not replayed).
   - New `POST /api/projects/[id]/regenerate` — re-runs the pipeline for
     an *existing* project (there was previously no way to regenerate one
     at all; every generate created a new project) and appends a new
     version rather than overwriting history.
   - New `POST /api/projects/[id]/versions/[versionId]/restore` — repoints
     `projects.design_json`/`current_version_id` at an older version;
     never mutates or deletes version rows.
   - New UI: a "Versions" tab (`VersionHistory.tsx`, list + restore
     button per non-current row) and a `RegenerateForm.tsx` next to
     "Download .vsdx" on the project page (collapsed button that expands
     to a prompt textarea pre-filled with the current prompt).
   - **Confirmed live**: migration run against the real Supabase project;
     Regenerate confirmed working (the campus-topology test above was
     run via Regenerate on an existing project). Restore not explicitly
     exercised yet, but shares the same code path/RLS model as Regenerate.

Also worth a decision alongside (1)-(2), not yet made: whether to improve
`design-to-flow.ts`'s edge routing/layout to address "connections don't
look all that great" (edges currently just draw straight lines with a
basic grid layout, no smart routing to avoid the crossing/overlap the
founder saw) — this wasn't literal BUILD_PLAN scope for Session 7-8 but
is the most direct fix for that specific piece of feedback.

**Vercel vs Railway vs Fly.io for `services/vsdx`** (asked about, not
decided): founder chose to keep Railway for now, adjustable later.
Alternatives if reconsidered: Vercel itself supports Python/ASGI
serverless functions, which would mean zero new accounts (same Vercel
project family) at the cost of a ~10s execution-time limit and needing to
confirm the checked-in `blank.vsdx` binary template bundles correctly as
a static asset; Fly.io is the other option CLAUDE.md already names
alongside Railway — a persistent container, closest to Railway's own
model, solid free tier.

Still separately open, deliberately not blocking: real stencils for
routers/switches/firewalls instead of generic colored rectangles/icons.
Leaning against proprietary Microsoft/Cisco stencils (licensing + the
`Connect.create()` master-copying fragility already seen once), toward
hand-built vendor-neutral vector icon shapes over embedded raster/SVG — but
this is the founder's call, not decided.

## Next step (BUILD_PLAN Session 9) — DONE

> "Implement the HLD document generator: design JSON → structured markdown
> (overview, assumptions, topology, IP plan, VLAN table, routing, security
> zones) with docx export."

New `packages/doc-gen` (6th workspace package), same deterministic/
template-only discipline as `config-gen` will follow — never calls an
LLM, only ever reads fields already present on a schema-valid `Design`.

- `generateHldMarkdown(design): string` — all seven BUILD_PLAN sections
  (VLAN table folded into IP Plan's Segments table rather than
  duplicated as its own section, since segments already *are* the VLAN
  table). Routing section only renders if `design.routing` is present;
  Security Zones falls back to listing bare `device.zone` values (with a
  note that no explicit policies exist) when `design.security` is empty,
  which is every design today — nothing populates `security` yet.
- `generateHldDocx(design): Promise<Buffer>` — same sections, built
  directly as Word document elements (headings/paragraphs/tables) via
  the pure-JS `docx` npm package, not by converting the markdown string
  (no pandoc or similar binary available in a Vercel serverless
  function, and markdown→docx conversion is its own can of worms with a
  templated-string intermediate that a real converter would have to
  parse back out — building both outputs independently from the same
  `Design` sidesteps that entirely).
- New `GET /api/projects/[id]/hld` (same RLS-scoped-by-owner pattern as
  `/export`) and a "Download HLD (.docx)" button next to "Download
  .vsdx" on the project page.
- Snapshot + assertion tests against G1/G4 (re-declared fixtures, same
  "don't depend on another package's test-only code" convention as
  `scripts/generate-design.ts`).

**Verified**: `pnpm run build`/`test`/`lint` all green (94 TS tests
total across 5 packages). For the `.docx` output specifically — since a
binary buffer isn't meaningfully snapshot-testable — wrote a real file
to disk and confirmed with `python3 zipfile` that it's a genuine OOXML
package (`word/document.xml`, `[Content_Types].xml` present) whose
`word/document.xml` actually contains the expected device IDs and
section headings, not just "starts with the right magic bytes." Not yet
verified: the `/api/projects/[id]/hld` route end-to-end against the live
deployed app (same sandbox limitation as every other authenticated route
in this repo) — real test is clicking "Download HLD (.docx)" on a real
project once this is merged.

## Next step (BUILD_PLAN Session 10) — DONE

> "FIRST CONFIG VENDOR. Create packages/config-gen with a nunjucks template
> set for cisco-ios: hostname, VLANs, SVIs, trunks/access ports, OSPF,
> HSRP, default route, NAT overload, and the lab-validation banner. Render
> per-device configs from design JSON. Snapshot-test against G1 and G4.
> Templates only — no LLM at render time."

Before writing templates, found a real gap this session revealed: G1's
dual-HSRP routers had no per-VLAN address of their own in `design_json`
at all — only the shared VLAN gateway (the HSRP virtual IP) existed.
Founder confirmed: fix it properly in `design-engine` first (per
CLAUDE.md's rule that IP math belongs in the engine, not templates),
then build config-gen on top of it.

**`design-engine`/`schema` fix** (prerequisite, not itself Session 10):
- `Interface` gained an optional `svis` field (`{vlanId, ip}[]`) — additive/
  backward-compatible, no `version` bump, since real production `design_json`
  already exists and must keep validating (see `packages/schema/src/zod/device.ts`).
- `ip-allocation/plan.ts`'s segment allocation gained `l3DeviceIds` (devices
  needing their own address on a segment, e.g. an HSRP pair) and returns
  `deviceIps` per segment. Single-device segments still get zero extra
  allocation — that device's own address is just the gateway (no
  redundancy, no ambiguity, no wasted address).
- `branch-office.ts`'s `assignInterfaces()` now attaches `svis` to a
  trunk's L3-capable end only (a router, never an access switch — those
  stay L2-only, unchanged). G1: rtr-01/rtr-02 get distinct `.2`/`.3`
  addresses per VLAN behind gateway `.1`. G4: the lone router's `svis`
  address *is* the gateway (no separate allocation).
- Verified: new `plan.test.ts` cases (distinct sequential addresses,
  empty `deviceIps` with no `l3DeviceIds`, a clear over-capacity error),
  a new explicit assertion per golden scenario (G1: never shares an
  address with its gateway or its peer, on any VLAN; G4: always equals
  the gateway), plus updated snapshots. Confirmed `services/vsdx` and
  the rest of the pipeline are unaffected — `svis` flows through
  services/vsdx's permissive pydantic models (`extra="allow"`) harmlessly
  since nothing there renders VLAN/interface-address data onto the
  diagram anyway; re-ran a live export against a local instance to confirm.

**`packages/config-gen`** (7th workspace package):
- `renderCiscoIosConfig(device, design)` / `renderAllConfigs(design)` —
  nunjucks templates (`templates/cisco-ios/{router,access-switch}.njk`),
  a TS view-model layer that does all the data-shaping (nothing computed
  inside the templates themselves), and a small self-contained CIDR
  helper (doesn't depend on `design-engine` at runtime — only needs
  single-address netmask conversion, not full block allocation).
- Router template: physical (P2P) interfaces, router-on-a-stick
  subinterfaces per VLAN (`interface Gi0/1.10`, `encapsulation dot1Q 10`),
  HSRP standby lines when `routing.firstHopRedundancy === "hsrp"`
  (alphabetically-first device id in the redundancy group = active/
  priority 110, everyone else = standby/100 — a documented, deterministic
  convention, not a guess), and a default route whose next-hop is looked
  up from the design's actual P2P link to whichever peer has role
  "firewall" (not invented — read straight from already-allocated data).
- Switch template: global VLAN database + trunk ports' allowed-VLAN list.
- OSPF is implemented (conditional on `routing.igp === "ospf"`) but,
  like NAT overload, **never exercised by G1/G4** — this composer always
  sets `igp: "static"`. **NAT overload was deliberately NOT implemented**:
  in every topology `composeBranchOfficeDesign` can produce, a router
  never has direct outside/internet connectivity — that link only ever
  terminates on the firewall (see `buildLogicalLinks`), so writing NAT
  config for the router would be speculative and untestable against any
  real scenario. Flagging this explicitly since BUILD_PLAN names it —
  it's a deliberate scope cut with a concrete reason, not an oversight.
- Every rendered config starts with the mandatory banner (CLAUDE.md hard
  rule 4), verified directly, not just visually.
- Vendor/role dispatch is a hard boundary: `renderCiscoIosConfig` throws
  `UnsupportedDeviceError` for anything that isn't `vendorHint:
  "cisco-ios"` + role `router`/`access-switch`; `renderAllConfigs` skips
  (doesn't error on) devices outside that — e.g. G1/G4's Fortinet
  firewall renders nothing here, which is correct (fortinet-fortigate
  templates are Phase 2, by CLAUDE.md's vendor rollout order).

**Verified**: `pnpm run build`/`test`/`lint` all green across all 7
workspace packages (121 TS tests total) plus `services/vsdx`'s 42 pytest
tests. Beyond snapshots, real rendered output was inspected by hand for
both G1 and G4 before locking in the snapshots — HSRP priorities,
virtual IP, default-route next-hop, and VLAN database all confirmed
correct against what the design JSON actually allocated, not just "the
template ran without crashing." **Not yet done**: wiring config-gen into
`apps/web` (a "Download configs" button, similar to `.vsdx`/HLD) —
BUILD_PLAN Session 10 only asks for the package + its tests, not web
integration; that's a natural follow-up, not yet built. One forward-
looking note if that happens: `packages/config-gen` loads its `.njk`
templates from disk at a path relative to the compiled module, which
works today (`pnpm run build`/`test`/the CLI script) but Vercel's
serverless bundler may or may not trace/include a directory that's only
read via a runtime `fs` call rather than `import`ed — worth confirming
directly (not assuming) before shipping a route that depends on it.

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
