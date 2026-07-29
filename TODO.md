# TODO — NetDesign.app

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
template ran without crashing." **Founder reviewed the actual rendered
cisco-ios output line-by-line (per CLAUDE.md's non-negotiable
vendor-template review rule) and confirmed it's correct** — the first
config-gen vendor is real-domain-expert-approved, not just test-passing.

## Next step (config-gen web integration) — DONE

Added the "Download configs" button (next to `.vsdx`/HLD) that TODO.md's
Session 10 entry flagged as a natural follow-up: new `GET
/api/projects/[id]/configs` calls `renderAllConfigs()` and returns every
supported device's config concatenated into one `.txt`, each section
delimited by a `! ===...` banner naming the device — no new dependency
(a zip-per-device archive would need one; a single delimited file needs
none, and is just as usable for copy-pasting into per-device consoles).
Extracted the three download routes' identical `slugify()` into
`lib/slugify.ts` — third copy-paste of the exact same function crossed
into "actually share this" territory.

**Confirmed a real deploy bug before it shipped, not after**: the
forward-looking note left in the Session 10 entry above turned out to be
a real problem, not a hypothetical. `packages/config-gen` loads its
`.njk` files via a runtime `fs` read (`nunjucks.configure()`), which
Next's build-time file tracer cannot see — checking the actual
`.next/server/.../configs/route.js.nft.json` after a real build showed
the template files were **not** included at all, which would have 404'd
or 500'd in production on Vercel despite passing every local
build/test/lint check. Fixed with `next.config.ts`'s
`outputFileTracingIncludes`, scoped to just this one route
(`/api/projects/\[id\]/configs` — the `[id]` segment must be
glob-escaped, since unescaped square brackets are a glob character
class, not a literal match; an unescaped key silently matches nothing,
which is exactly how this almost shipped broken). Verified twice: with a
deliberately over-broad `"**"` key first (to confirm the mechanism works
under Turbopack at all), then with the real, correctly-scoped key
(confirmed the templates appear in `configs`'s trace file and nowhere
else's).

## Next step (BUILD_PLAN Session 11-12, item 1: clarifying-question error handling) — DONE

Founder approved this order for hardening: (1) clarifying questions →
(2) rate limiting → (4) confirm G1/G4 golden suite → pause for founder to
set up a PostHog account before (3) analytics. This entry covers item 1
(items 2 and 4 to follow in later sessions; item 3 is blocked on the
founder's PostHog account).

**The gap**: `extractDesignParams()` forced Claude to call
`emit_design_params` via `toolChoice: {type: "tool", name: TOOL_NAME}` —
architecturally, Claude could never decline or ask a question. This is
why the earlier campus/three-tier test prompt got silently mapped onto
`branch-office` with the gap recorded as an "assumption" instead of the
system asking what the founder actually wanted — correct behavior for
prompts close enough to guess, but a bad default for prompts that aren't
close to either supported pattern at all.

**Fix, in `packages/llm-extraction`**:
- `src/prompt.ts`: added a second tool, `ask_clarifying_questions`
  (`{questions: string[]}`, 1-3 items, schema derived from a new
  `clarifyingQuestionsSchema` zod schema via the same `zodToJsonSchema()`
  pattern already used for `emit_design_params`). Added `zod` as a direct
  dependency (was only available transitively through `@netdesign/schema`
  before — now imported directly, so it belongs in `package.json`).
  Rewrote `SYSTEM_PROMPT` to tell Claude to prefer emitting design-params
  (simplify/guess, record the gap in "assumptions") and only reach for
  the clarify tool when a fact would have to be fabricated outright, not
  simplified — e.g. a topology that doesn't resemble either flat pattern
  at all, or no usable signal on router/switch counts whatsoever.
- `src/client.ts`: `toolChoice` type widened to
  `{type: "tool", name: string} | {type: "any"}` — deliberately not
  `{type: "auto"}`, since a plain-text-only response is never an
  acceptable outcome; some tool call is still forced, just not a specific
  one.
- `src/extract.ts`: `extractDesignParams()` now offers both tools with
  `toolChoice: {type: "any"}`. New `NeedsClarificationError extends Error`
  (carries `questions: string[]`), thrown by `parseExtractionResponse()`
  when the response's `tool_use` block names the clarify tool instead of
  `emit_design_params` — same established pattern as the existing
  `DesignParamsExtractionError`, not a return-type change, so it stays a
  minimal diff against the current call sites.
- `generate.ts` needed no changes — it just calls `extractDesignParams()`
  then `composeBranchOfficeDesign()`, so the new error propagates through
  for free.
- Tests: `prompt.test.ts` (+2), `extract.test.ts` (+3, including
  `extractDesignParams()` propagating `NeedsClarificationError` end to
  end), updated the existing "forces the tool" test to assert
  `{type: "any"}` and both tools offered instead. All 18
  `llm-extraction` tests pass.

**Wired into `apps/web`**: both `app/api/generate/route.ts` and
`app/api/projects/[id]/regenerate/route.ts` gained a
`NeedsClarificationError` catch branch returning
`{needsClarification: true, questions: [...]}` at 422 (checked before the
existing `DesignParamsExtractionError`/`DesignValidationError` branch,
since `NeedsClarificationError` doesn't extend either). `NewProjectPage`
and `RegenerateForm` both now check for `needsClarification` in the error
response and render the returned questions in an amber callout instead of
the generic red error text, with a prompt to add the missing detail and
resubmit — no new Q&A flow (the user just edits their prose), since a
structured back-and-forth wasn't asked for and the existing regenerate/
retry loop already covers "try again with more detail."

**Not yet manually tested against the real Claude API** (only via the
fake-client unit tests) — same sandbox limitation as prior sessions;
this needs a real ambiguous prompt (e.g. the earlier campus/three-tier
one) tried against the deployed app to confirm Claude actually reaches
for the new tool rather than continuing to guess. Founder should try that
once this is live.

**Item 4 (confirm golden suite) also done in passing**: full
`pnpm test:golden` run (build + `test/golden` in `design-engine`) is
green — 22 tests across G1 and G4. Only G1/G4 composers exist; G2/G3/G5
were flagged to the founder as scoping gaps before this session started
and are not being fabricated here.

Full monorepo `pnpm run build`, `pnpm -r run test`, `pnpm run lint`, and
`pnpm run test:golden` all green before this commit.

**Next**: item 2 (rate limiting) — planned to use Supabase (a table +
row-count/timestamp check, or a Postgres function) rather than a new
external service like Upstash, to avoid requiring the founder to set up
another account. Then pause for the founder's PostHog account before
item 3.

## Next step (BUILD_PLAN Session 11-12, item 2: rate limiting) — DONE

Continues the approved hardening order (item 1 clarifying questions →
item 2 rate limiting → item 4 confirm golden suite → pause for founder's
PostHog account before item 3).

**Why Supabase, not Upstash/Redis**: rate limiting only needs to stop a
signed-in user from burning Claude API spend in a tight loop — it's not
high-throughput enough to need a dedicated store, and adding Upstash
would mean the founder setting up yet another account/env var for a
problem Postgres already solves. Chose an append-only events table over
a per-user counter column: a counter needs separate increment/reset/decay
logic to get the rolling window right; a table just needs "count rows
newer than `now() - interval`," and it doubles as an audit trail for
free.

**`supabase/migrations/0003_generation_rate_limit.sql`**: new
`generation_events (id, owner_id, created_at)` table, RLS scoped to
`auth.uid() = owner_id` (same pattern as `projects`, not the join-through
pattern `project_versions` needed, since this table has its own owner
column). Empirically verified against a local Postgres 16 instance
(stood up, then torn down, same as the 0002 migration's verification):
seeded a stub `auth.uid()` function reading a session GUC, confirmed (a)
a user can insert their own event, (b) inserting an event with someone
else's `owner_id` is rejected by RLS, and (c) the rolling-window count
query correctly scopes to one user's own rows and correctly excludes a
row seeded 2 hours in the past when filtering `created_at >= now() -
interval '1 hour'`.

**`apps/web/lib/rate-limit.ts`** (new): `checkGenerationRateLimit(supabase,
ownerId)` counts the user's `generation_events` in the last hour via
`.select("id", {count: "exact", head: true})` (no rows fetched, just the
count) and compares against `GENERATION_RATE_LIMIT_PER_HOUR` (env var,
default 20 — a flat abuse ceiling, not a paid-plan quota, since there are
no billing tiers yet and CLAUDE.md says not to touch Stripe without
founder review). `recordGenerationEvent(supabase, ownerId)` inserts one
row. Both take the same `SupabaseClient<Database>` already constructed by
each route's `createClient()`, no new client/connection.

**Wired into both generation entry points**: `app/api/generate/route.ts`
and `app/api/projects/[id]/regenerate/route.ts` each call
`checkGenerationRateLimit()` after parsing the request body (no point
rate-limiting a request that's going to 400 anyway) and before the
`try` block, returning 429 with a plain-English message if over the
limit. Inside the `try`, `recordGenerationEvent()` is called *before* the
Claude API call — a failed extraction still spent Claude API tokens, so
it still counts against the hour, not just successful generations.

`apps/web/lib/supabase/types.ts` gained the `generation_events` table
shape, hand-mirrored from the migration like the other two tables.

**Not yet manually verified against the deployed app** (same sandbox
limitation noted for item 1) — needs the founder to run
`0003_generation_rate_limit.sql` against the real Supabase project (same
"paste into the SQL editor" step as `0002_project_versions.sql` before
it), then optionally try generating >20 times in an hour to see the 429.
Default of 20/hour is a guess or a boring-option call — the founder may
want to tune `GENERATION_RATE_LIMIT_PER_HOUR` in Vercel once they see
real usage.

Full monorepo `pnpm run build`, `pnpm run typecheck`, `pnpm -r run
test`, and `pnpm run lint` all green before this commit. No changes
needed in `packages/llm-extraction` or any other package — this is
entirely an `apps/web` + Supabase migration concern.

**Next**: item 4 (re-confirm G1/G4 golden suite) was already re-verified
in passing during item 1's session (22 tests green); nothing further to
do there before the PostHog pause ahead of item 3.

## Next step (BUILD_PLAN Session 11-12, item 3: PostHog analytics) — DONE

Founder set up a PostHog account and used its GitHub-linked wizard
("PostHog Code") to auto-generate the integration rather than have me
build it from scratch — PR #12, `posthog[bot]`. Reviewed the PR before
merge (not rubber-stamped): read the full diff, then actually ran the
branch in a throwaway git worktree (real `pnpm install` + `next build` +
a live `next dev` server hit with headless Chromium, plus a local
Postgres-style empirical check where relevant) rather than reasoning
about it in the abstract. Found three real, confirmed-not-guessed bugs
before merge and pushed fixes directly onto the PR's branch
(`posthog/instrumentation-ec9f5f`, commit `a4b7ee7`):

1. **Analytics silently dead for anyone not yet signed in.** The
   pre-existing auth gate (`apps/web/proxy.ts` matcher +
   `lib/supabase/middleware.ts`'s `PUBLIC_PATHS`) redirects any
   unauthenticated request to `/login` unless explicitly exempted. The
   PR added `/ingest/*` rewrites for PostHog but never exempted that
   path — confirmed via `curl` that `/ingest/decide` came back as a 307
   to `/login` instead of being proxied. This broke PostHog's own
   bootstrap call and the login page's `magic_link_requested` event for
   every anonymous visitor, i.e. the entire top of the "Sign-in to first
   design" funnel. Fixed by excluding `ingest` in `proxy.ts`'s matcher.
2. **Client and server events used two different identities.** Server
   routes captured with `distinctId: user.id` (the real Supabase UUID);
   client-side captures (`login/page.tsx`, `projects/new/page.tsx`,
   `RegenerateForm.tsx`) never called `posthog.identify()`, so they
   stayed on the browser's anonymous id forever. That splits both the
   "Design generation funnel" and "Sign-in to first design" funnel
   across two unrelated person profiles — exactly the two insights the
   PR's own dashboard highlights. Fixed with a new
   `components/PostHogIdentify.tsx` (client component, mounted once in
   `app/layout.tsx`) that identifies the browser as `user.id` as soon as
   a Supabase session is found.
3. **Local dev broke on every page load without the new env vars.**
   `instrumentation-client.ts` threw at module load whenever
   `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` was unset outside production —
   confirmed via a headless-Chromium hit against a real `next dev`
   server (uncaught page error, not just a lint-level guess). Since
   `.env.example` was never updated with the two new vars either, this
   would've broken `pnpm dev` for any fresh clone until someone
   discovered and set two undocumented variables — a direct hit against
   this project's "leave the repo green" session-resumability rule.
   Downgraded to `console.warn` and documented both vars as optional in
   `.env.example`.

Also set `disable_session_recording: true` explicitly: none of the PR's
6 dashboards/insights use session replay, and this app's post-generation
pages render real customer network data (IP plans, device lists, real
topology) as plain DOM content that posthog-js's default input-masking
(`maskAllInputs: true`, verified by reading the bundled source) wouldn't
cover if replay were ever turned on at the project level later without
this context.

Founder set the two Vercel env vars, marked the PR ready for review, and
merged it (#12, merged into `main`). Rebased this branch onto the new
`main` afterward — the PostHog PR touched the same 4 files as items 1/2
above (`generate/route.ts`, `regenerate/route.ts`, `projects/new/page.tsx`,
`RegenerateForm.tsx`); the rebase resolved automatically with no
conflicts. Full monorepo build/test/lint re-verified green on the
combined result post-rebase.

**Not yet verified**: real events actually landing in the PostHog
Activity view / dashboard populating post-deploy — that's on the founder
to confirm by clicking through the live app once Vercel's redeploy with
the new env vars is live.

This closes out all four Session 11-12 hardening items (1 clarifying
questions, 2 rate limiting, 3 PostHog, 4 golden suite re-confirmed).
**Still not merged**: this branch itself (items 1+2, clarifying
questions + rate limiting) has no PR yet — founder hasn't asked for one.
Also still outstanding from item 2: the founder needs to run
`supabase/migrations/0003_generation_rate_limit.sql` against the
production Supabase project.

## Next step (Phase 2 prep: polish the in-app diagram) — DONE

The in-app React Flow diagram used to group devices into one dashed "zone"
box laid out as a wrapping 3-column grid. Since neither composer
(branch-office/smb-flat) actually sets `device.zone`, every device fell
into a single "Ungrouped" grid — the "bag of boxes" look the founder
flagged (the design only looked like a network diagram once exported to
Visio/draw.io, which apply their own layout). Replaced it with a
role-tiered hierarchical layout so the *in-app* view reads like a real
diagram, top-to-bottom.

**What changed (all in `apps/web`, no engine/schema/API touch):**
- `components/flow/role-meta.ts` (new): role → vertical tier rank
  (internet → firewall → routers → switches → endpoints), human label,
  and accent colors (bar class + icon class + minimap hex). Tiers are
  *compacted* at layout time so empty ranks leave no gap (a branch office
  uses only firewall/router/access-switch tiers).
- `lib/design-to-flow.ts`: rewritten. Buckets devices by role rank,
  compacts ranks to rows, centers each row under the widest tier, and
  assigns each edge the right handle pair — inter-tier links flow
  top→bottom (higher device's bottom handle → lower device's top),
  same-tier links go side-to-side (left device's right handle → right
  device's left). Verified against a real composed G1 design: the 5th
  link (`sw-01 ↔ sw-02` port-channel) correctly renders as a horizontal
  same-tier edge, the rest as vertical inter-tier edges.
- `components/flow/DeviceNode.tsx`: four directional handles (t/l as
  targets, r/b as sources), role accent bar + role-colored icon, human
  role label + optional zone, and an "HA" badge when
  `device.redundancyGroup` is set.
- `components/DesignCanvas.tsx`: dropped the ZoneNode; role-colored
  MiniMap dots; cleaner default edge styling (grey smoothstep, subtle
  labels); `fitView` padding.
- Deleted `components/flow/ZoneNode.tsx` (now unused; zone is shown as a
  node badge instead of a big box).

**Verified visually, not just by types**: composed a real G1 design,
rendered it through the actual `DesignCanvas` in a throwaway route via a
headless-Chromium screenshot, and confirmed the hierarchy (firewall on
top, HSRP router pair with HA badges centered below, access switches at
the bottom, port-labelled orthogonal links). Screenshot shared with the
founder. Scaffolding (preview route, temp env, generator script) all
torn down; only the 5 real source changes remain. Full monorepo
build/typecheck/lint/test green.

**Decision noted**: zone *grouping boxes* were removed rather than kept,
because no current composer emits zones — a per-node zone badge covers
today's needs. When a zone-aware composer lands (e.g. a real DMZ design,
G5), revisit whether to bring back swimlane/backdrop grouping; the role
tiers and badge are the interim.

## Next step (pre-beta: live-funnel landing page + waitlist) — DONE

Before Phase 2 recruiting, built a marketing landing page at `/` so the same
traffic that recruiting posts drive gives both interest metrics and an
activation funnel. Chose the live-funnel version over a fake-door/waitlist-only
page — the product already works, so the CTA routes into the real sign-in →
generate flow, and PostHog captures `landing view → CTA click → sign-in →
first design` end to end. A waitlist section captures people not ready to sign
up.

- `app/page.tsx`: was a bare redirect (anon → /login); now renders the landing
  for anonymous visitors (signed-in users still redirect to /projects). Hero +
  "how it works" + deliverables + waitlist + footer.
- `components/landing/HeroDiagram.tsx`: static inline SVG mock of a role-tiered
  topology (Internet → firewall → HSRP router pair w/ HA badges → switches),
  mirroring the real in-app diagram's tiers/colors without pulling React Flow
  into the hero.
- `components/landing/TryFreeButton.tsx`: captures `landing_cta_clicked`
  (with a `location` prop) then routes to `/login?next=/projects/new`.
- `components/landing/WaitlistForm.tsx`: POSTs to `/api/waitlist`, captures
  `waitlist_joined` client-side (same person as the pageview, so the funnel
  stays on one profile).
- `app/api/waitlist/route.ts`: public POST, zod-validates email, inserts;
  treats a unique-violation (23505) as success ("already on the list").
- `supabase/migrations/0004_waitlist.sql`: `waitlist` table, case-insensitive
  unique email index, RLS allowing anon/authenticated INSERT but NO select
  policy (founder reads via dashboard/service role).
- `lib/supabase/middleware.ts`: added `/api/waitlist` to PUBLIC_PATHS so
  anonymous visitors can submit (otherwise the auth gate 307s it to /login).
- `app/login/page.tsx`: now forwards a `?next=` param through the magic link
  (read from `window.location.search` to avoid a Suspense boundary), so the
  CTA lands the user on /projects/new after sign-in. `auth/callback` already
  honored `next`.
- `lib/supabase/types.ts`: added the `waitlist` table shape.

Verified: full `pnpm run build` + `lint` + web `typecheck` green; landing page
rendered headlessly (200, no console errors, all sections, hero diagram
correct); `/api/waitlist` confirmed reachable anonymously (not redirected) and
rejecting bad email with 400; "Try it free" confirmed navigating to
`/login?next=/projects/new`.

**Founder action needed**: run `supabase/migrations/0004_waitlist.sql` against
the production Supabase project (same SQL-editor step as prior migrations)
before the waitlist form works live. The rest deploys with the normal Vercel
push.

## Deployment / ops runbook (custom domain, auth, migrations)

Live stack: **Vercel** (apps/web), **Supabase** (Postgres + auth), **Railway**
(services/vsdx), **Resend** (auth email via custom SMTP), **PostHog** (analytics).
This is the right architecture — don't move apps/web to Hostinger static/shared
hosting (it's a full Next.js server app: SSR, API routes, auth). Hostinger is
the domain registrar only.

**Custom domain (in progress): `app.jactictservices.com`**
- Added in Vercel → Settings → Domains; DNS is a `CNAME` `app → cname.vercel-dns.com`
  in Hostinger. Vercel custom domains are FREE on Hobby — the "$10/mo per domain"
  the founder saw was **Supabase's** custom-domain add-on (for the auth API
  hostname), which is NOT needed; skip it.
- **Required whenever the public URL changes** (or magic-link auth breaks with a
  localhost/`?code=` redirect to the wrong host): Supabase → Authentication →
  URL Configuration →
  - **Site URL** = `https://app.jactictservices.com`
  - **Redirect URLs** allow-list += `https://app.jactictservices.com/**`
    (keep `https://<vercel-domain>/**` too if you want the raw Vercel URL to work).
  Our code already sets `emailRedirectTo = ${origin}/auth/callback`; the localhost
  redirect bug is always the Supabase Site URL / allow-list being stale, not code.

**Migrations run against production Supabase so far:** 0002 (versions),
0003 (rate limit), 0004 (waitlist). Run each new `supabase/migrations/*.sql`
in the Supabase SQL editor after it lands.

**Magic-link should be ONE email, not two (Supabase "Confirm email" setting).**
Symptom: a new tester gets a "Confirm your email address" email, clicking it
lands back on the login page, and only the *second* email ("Your sign-in link")
actually signs them in. Cause: Supabase has **email confirmations ON**, so a
brand-new address must confirm signup *before* the magic link works. For a
passwordless/magic-link app this step is redundant — clicking a link sent to the
address already proves ownership. **Fix (dashboard):** Authentication →
Providers → Email (or Sign In/Up settings) → turn **OFF "Confirm email"**
(a.k.a. "Enable email confirmations"). After that a new address gets a single
"Your sign-in link" email that creates the account and signs in on click. Safe
for magic-link auth (no password ⇒ no unconfirmed-account risk). No code change.

**Where tester data lives:**
- Waitlist emails → `public.waitlist` (Supabase → Table Editor → waitlist).
- Signed-in tester accounts → Supabase-managed `auth.users` (Authentication →
  Users).
- Their projects/designs + version history → `public.projects` +
  `public.project_versions`. Generation attempts → `public.generation_events`.
- Product analytics (events/funnels) → **PostHog**, not Supabase.
- Auth emails are *sent* via Resend (send logs in the Resend dashboard); the
  addresses themselves persist in Supabase, not Resend.

## Next step (diagram restyle to match the warm landing look) — DONE

Founder feedback on the in-app project diagram: (1) two boxes in the bottom
corners they disliked — those were React Flow's `Controls` (bottom-left
toolbar) and `MiniMap` (bottom-right white rectangle); (2) it didn't match the
new warm-editorial landing hero. Fixed both, styling only:
- `DesignCanvas.tsx`: dropped `<Controls>` and `<MiniMap>`; the canvas is now a
  cream (#f7f7f4) "artboard" with warm hairline dots, hairline edges, and mono
  edge labels — committed warm (explicit hex, no `dark:` variants) so it looks
  the same regardless of the viewer's OS theme, exactly like the hero.
- `DeviceNode.tsx`: white cards with a 1px hairline (no shadow), monochrome
  muted role icons, mono hostname + `role · zone` subtitle in ink/muted, and an
  outline-hairline `HA` pill — the hero treatment applied to real nodes.
- `role-meta.ts` left intact (roleRank/roleLabel still drive layout + subtitle);
  the now-unused `roleAccent` color map is kept as dormant API rather than
  deleted, in case colored roles are wanted back later.
- Verified by rendering a composed G1 design through the real `DesignCanvas`
  headlessly (throwaway preview route, since the canvas needs an authed page):
  cream artboard, mono-labelled white nodes, no Controls/MiniMap, correct
  hierarchy.

Note: the rest of the authenticated app (projects list, new-project, the
IP-Plan/Device-List/Assumptions tables, login) is still the default slate/dark
theme — only the diagram + landing page are warm. A full warm rebrand of the
signed-in app is a possible follow-up if the founder wants end-to-end
consistency; not done here to keep this change scoped.

## Next step (Phase 2 vendor rollout: fortinet-fortigate config-gen) — DONE

Extended config-gen beyond cisco-ios to render a FortiGate base config for
the edge firewall. Because a FortiGate config has real design choices the
composed data doesn't dictate (unlike cisco routers/switches, where interfaces
+ VLANs + HSRP fully determined the output), I asked the founder (domain
expert, per CLAUDE.md) three questions up front rather than inventing posture:
- **WAN interface** → DHCP client (`port1`, `set mode dhcp`) — the ISP link
  isn't ours to address, so nothing is hardcoded.
- **LAN routing** → ECMP: one static route to each VLAN subnet via BOTH HSRP
  routers' /31 peer IPs (survives a single router loss).
- **Policy posture** → interfaces + routing only, no firewall policies.

**Files (`packages/config-gen`):**
- `src/fortigate-view.ts` (new): `buildFortiGateView()` — port1 WAN(dhcp), then
  each modeled router-facing interface as a static inside port (port2, port3…);
  `routerPeerIp()` finds each ECMP next hop from the real link/peer-interface
  data (not /31 arithmetic).
- `templates/fortinet-fortigate/firewall.njk` (new): the FortiOS template.
- `src/render.ts`: added `renderFortiGateConfig()`; `renderAllConfigs()` now
  emits the fortinet-fortigate firewall alongside the cisco devices, so the
  web **Download configs** button includes it.
- Tests: new `test/fortigate.test.ts` (10) + updated `render.test.ts` (the
  firewall is no longer skipped; banner assertion is now per-vendor) +
  regenerated snapshot. config-gen 22 → 32 tests, all green.
- `apps/web/.../configs/route.ts`: updated the "no supported devices" message.

**Banner deviation (founder-approved):** CLAUDE.md hard-rule #4 mandates the
`! Base configuration generated by NetDesign.app — validate in a lab before
production.` banner. `!` is not a FortiOS comment — it would be an invalid
command on line 1 of a FortiGate paste — so the FortiGate config renders the
**same sentence as a `#` comment** (`FORTIGATE_BANNER`). Founder explicitly
OK'd this vendor-correct deviation, and also OK'd `set allowaccess ping` on the
inside interfaces. The founder reviewed the full rendered G1 output line-by-line
("All is good") — satisfying CLAUDE.md's vendor-template review rule, same as
the cisco-ios sign-off.

**Next vendor:** paloalto-panos (BUILD_PLAN Session 16), by tester vote.

## SCOPING: campus / multi-tier composer (next big composer) — IN PROGRESS

Why: branch-office/smb-flat only covers 1–2 routers + 1–4 access switches +
0–1 firewall, flat single tier. Testers will ask for bigger, multi-tier campus
designs; today those get simplified to flat + an Assumptions note (or a
clarifying question). To let beta prove the product on real enterprise
topologies, build the next composer. Maps to CLAUDE.md golden **G2 campus**
(collapsed core, N access switches, wireless controller, voice VLAN).

**Recommended first target: collapsed-core campus** (not full three-tier).
A single L3 core pair does both core + distribution; access switches (L2)
uplink to it; VLAN gateways (SVIs) live on the core pair with HSRP. This
covers most mid-size campuses and is a clean, testable increment over
branch-office. Full three-tier (separate distribution tier) can follow.

**Proposed shape (collapsed-core):**
```
        WAN/Internet
             │
        [firewall]              (optional, reuse branch edge)
             │
      [router(s)]               (optional edge routing, reuse HSRP machinery)
             │
   ┌── core-01 ══ core-02 ──┐   L3 pair, HSRP SVIs = VLAN gateways
   │      (peer link)       │
 [acc-01] [acc-02] ... [acc-N]  L2 access, trunk uplinks to BOTH cores
        (+ wireless-controller, voice VLAN)
```

**What needs to change:**
1. **schema/designParams** (`packages/schema`): new `designPattern: "campus"`;
   add `coreSwitch: { count (2 for HA), vendorHint }`, raise/relax
   `accessSwitch.count` max (campus wants >4), optional
   `wirelessController: { present, vendorHint }`. Bump schema version
   deliberately (real prod design_json exists).
2. **design-engine composer** (`packages/design-engine/src/compose/campus.ts`):
   place core pair + N access switches; L2 trunks access→core; core↔core peer
   link; SVIs (VLAN gateways) on the core pair. **Reuse the HSRP/`l3DeviceIds`
   machinery already built for branch HSRP routers** — the core pair is exactly
   the same "shared VLAN gateway = virtual IP, each L3 device gets its own
   per-VLAN address" pattern, just on SVIs instead of router subinterfaces.
3. **config-gen** (`packages/config-gen`): new cisco-ios **L3 core-switch**
   template — global VLAN db + per-VLAN SVI with HSRP + L2 trunk uplinks +
   (optionally) a routed uplink to the edge. Access-switch template already
   works. FortiGate/edge unchanged.
4. **llm-extraction** (`packages/llm-extraction`): add the `campus` pattern to
   the prompt + 1–2 few-shot examples so intent extraction targets it instead
   of simplifying to flat.
5. **doc-gen / vsdx / diagram**: the role-tiered layout + HLD already handle
   core-switch/distribution roles (roleRank has them); mostly free once devices
   carry those roles.
6. **Tests**: G2 golden fixture + compose/config-gen tests, same discipline as
   G1/G4.

**DECISIONS — LOCKED WITH FOUNDER (2026-07):**
- **Full three-tier** (not collapsed core): access (L2) → distribution (L3) →
  core (L3 transit) → edge.
- **L2 access + HSRP SVI gateways.** Access switches are L2 with trunk uplinks
  to BOTH distribution switches. VLAN gateways (SVIs) + HSRP live on the
  **distribution** pair (standard textbook placement — resolved by me from the
  collapsed-core-framed "SVIs on core" answer; flag at render-time review, same
  as the FortiGate/cisco template sign-off).
- **Routed core with OSPF.** distribution↔core and core↔edge are routed /31
  links; OSPF area 0 across the L3 layers (reuses the engine's existing OSPF
  view-model + config-gen plumbing). Resolved by me (founder declined the
  follow-up) — flag at review.
- **Reuse the branch edge:** optional FortiGate firewall + optional HSRP router
  pair above the core, so it composes with the existing FortiGate/router
  config-gen.
- **Voice VLAN now** (already just purpose:voice), **wireless controller
  deferred** to a follow-up.

**Topology (first cut):**
```
[fw-01]                        optional edge firewall (reuse branch edge)
   │
[rtr-01 ══ rtr-02]             optional HSRP router pair (reuse)
   │
[core-01 ══ core-02]           L3 core pair, routed /31 to edge + each dist, OSPF
   │   ╲   ╱   │
[dist-01 ══ dist-02]           L3 dist pair: SVIs + HSRP = VLAN gateways, OSPF up
   │              │
[acc-01] [acc-02] ... [acc-N]  L2 access, trunk to BOTH dist switches
```

**Build order (each its own PR-sized increment, repo green between):**
1. **schema-params** (`packages/schema`): add `"campus-three-tier"` to
   `designParamsPatternSchema`; add optional `coreSwitch`/`distributionSwitch`
   ({count, vendorHint}, default 2/2 HA pairs); raise `accessSwitch.count` max
   (campus wants >4). NOTE the coupling: the params pattern enum feeds BOTH the
   composer dispatch AND the LLM tool schema — so ship it together with the
   composer + a dispatcher, or the LLM could emit campus before anything
   composes it.
2. **composer** (`packages/design-engine/src/compose/campus.ts` + a
   `composeDesign(params)` dispatcher that routes by `designPattern`): build the
   4 tiers; host VLAN segments carry `l3DeviceIds = [dist-01, dist-02]` (reuse
   the HSRP SVI addressing already built for branch HSRP routers); all
   inter-tier links are P2P /31 (reuse `allocateP2pLinks`); `routing.igp =
   "ospf"`. Validate via `parseDesign`. **G2 golden compose test** (zero subnet
   overlap, SVIs+HSRP on distribution, OSPF, etc.).
3. **llm-extraction**: add the campus pattern to the prompt + 1–2 few-shot
   examples so intent routes to campus (last, so users can trigger it).
   → After this increment, campus **designs + diagram + HLD + .vsdx** all work
     (role-driven). Config for the new L3 switch roles is skipped (like
     FortiGate was initially), not errored.
4. **config-gen** (follow-up): cisco-ios **distribution** template (VLAN db +
   per-VLAN SVI with HSRP + OSPF + L2 trunk downlinks + routed /31 uplinks) and
   **core** template (routed /31 + OSPF, no host SVIs). Founder reviews the
   rendered G2 output line-by-line, same discipline as cisco-ios/FortiGate.

**Status (Session — campus composer BUILT, steps 1–3 DONE):**
Steps 1–3 of the build order are shipped and the whole workspace is green
(build + test + typecheck + lint):
- **schema-params**: `"campus-three-tier"` added to `designParamsPatternSchema`;
  optional `coreSwitch`/`distributionSwitch` ({count 2/2, vendorHint}) added;
  `accessSwitch.count` max raised to 24. (`packages/schema/src/zod/design-params.ts`)
- **composer + dispatcher**: `packages/design-engine/src/compose/campus.ts`
  (`composeCampusDesign`) + a `composeDesign(params)` dispatcher in
  `compose/index.ts` that routes by `designPattern`. Shared interface/VLAN-id
  helpers were extracted to `compose/shared.ts` so branch and campus share one
  tested code path; SVIs land on distribution automatically (only L3-capable
  role holding an L2 trunk to access) and are anchored to the first access trunk
  so a dist switch with N access trunks emits each SVI once. **G2 golden compose
  test** passes: SVIs+HSRP on distribution (`redundancyGroup: hsrp-dist`), core
  pure L3 (routed /31 only, no trunk/SVI), OSPF area 0 across all L3 devices,
  access L2-only, zero subnet overlap.
  (`packages/design-engine/test/golden/compose-g2-campus.test.ts` + fixture)
- **llm-extraction**: campus pattern in `TOOL_DESCRIPTION`/`CLARIFY_TOOL_DESCRIPTION`,
  a 4th campus few-shot example, and SYSTEM_PROMPT rules for when to pick campus +
  to set coreSwitch/distributionSwitch. `generateBranchOfficeDesign` renamed to
  `generateDesign` and now calls the `composeDesign` dispatcher; apps/web
  `/api/generate` + `/api/projects/[id]/regenerate` and the `scripts/generate-design.ts`
  CLI (new `--fixture g2`) updated. Tests updated (4 examples, enum incl campus,
  campus end-to-end dispatch case).

  → campus **designs + diagram + HLD + .vsdx** all work now (role-driven);
    config-gen for the new L3 switch roles is intentionally skipped (renders
    branch/edge only), not errored — same as FortiGate was initially.

**Step 4, config-gen — DONE (needs founder line-by-line review):**
Built the cisco-ios **distribution** template (`ip routing` + VLAN db +
per-VLAN `interface VlanN` SVI with HSRP + routed /31 uplinks + L2 trunk
downlinks + OSPF) and **core** template (`ip routing` + routed /31 + OSPF, no
VLANs/SVIs/trunks). Also:
- OSPF is now **per-device connected-networks** (`buildOspfForDevice`) instead
  of blindly advertising every VLAN — a core advertises only its /31s + loopback,
  a distribution advertises its SVI subnets + /31 uplinks. New
  `cidrToNetworkAndWildcard` helper masks host bits for the `network` base.
- Edge routers now emit `default-information originate` (they hold the static
  default toward the firewall) so the campus interior learns the default via OSPF.
- `renderCiscoIosConfig`/`renderAllConfigs` handle `distribution-switch` +
  `core-switch`; **G2 config snapshot + assertions** added (SVIs+HSRP on dist,
  pure-L3 core, L2 access, default-origination on edge). Full config-gen suite green.

**Campus design contract — CONFIRMED WITH FOUNDER (2026-07), now locked + implemented:**
1. SVIs+HSRP on **distribution** (textbook placement). ✅
2. **OSPF area 0** across the L3 routing core (single-area). ✅
3. HSRP: **alphabetically-first device = active (priority 110)**, others standby (100). ✅
4. **Firewall is NOT an OSPF speaker** — the FortiGate runs static/ECMP, so it's
   dropped from `routing.ospfAreas`, and the edge routers mark their firewall-facing
   link **`passive-interface`** (subnet advertised, no adjacency attempted). ✅
   Distribution **SVIs are passive too** (they face L2 access/hosts, never an OSPF
   neighbor). Implemented via `buildOspfForDevice`'s speaker-set check +
   `ospfSpeakerIds`/`peerDeviceIdOf` helpers; G2 compose + config snapshots and
   assertions updated. Full suite green.

## BACKLOG (future add-on): sketch upload → rebuilt design — NOT STARTED

**Goal:** let an engineer upload a rough network sketch (hand-drawn photo,
whiteboard shot, or a Visio/draw.io/PNG export) and have the tool infer the
topology, then run it through the *existing* deterministic pipeline —
producing IP addressing, VLANs, validation, diagram, HLD, .vsdx, and base
configs, exactly like the prose path. Founder explicitly wants this kept on
the roadmap (2026-07).

**Why it fits cleanly:** it's just a new *front door* to the same pipeline.
Claude is multimodal, so the sketch → `design-params` step is the vision
analogue of the prose → `design-params` extraction we already have. The moat
(design-engine) is untouched — the LLM still only *proposes* params; the
engine still disposes (IP math, no overlaps, schema-validate). Same hard
rules apply.

**Build order (each a PR-sized, repo-green increment):**
1. **vision extraction** (`packages/llm-extraction`): a new
   `extractDesignParamsFromImage(image, options)` that sends the image to
   Claude with the *same* `emit_design_params` / `ask_clarifying_questions`
   tool contract, plus a vision-specific system prompt + a couple of
   sketch→params few-shot pairs. Reuses `designParamsSchema` and the existing
   `generateDesign` composer dispatch — output is identical to the prose path.
2. **assumptions/confidence review step** (critical): a sketch is lossy, so
   the extractor must surface *everything it inferred* (device counts, roles,
   redundancy, VLANs, which pattern) into `assumptions`, and the UI must show
   an editable confirmation screen BEFORE composing. Never silently commit a
   guessed topology. Low-confidence or unreadable input → route to
   `ask_clarifying_questions`, same as ambiguous prose.
3. **upload UI + storage** (`apps/web`): an image dropzone on the new-project
   flow (accept png/jpg/pdf, size cap), store the original in Supabase storage
   (private bucket, owner-scoped), a new `/api/generate-from-sketch` route.
   Rate-limit + PostHog-instrument the same as `/api/generate`.
4. **tests**: fixtures of a few representative sketches → expected params;
   golden that a sketch maps onto a G1/G2/G4 design; assert the review step
   blocks auto-compose when confidence is low.

**Open questions to settle with founder before building:**
- Accepted input formats (photos only, or also structured Visio/draw.io XML —
  the latter is parseable, not a vision problem, and much higher fidelity).
- How much the tool should *correct* vs. *faithfully reproduce* a sketch
  (e.g. add HSRP the sketch omitted?) — a networking judgment call.
- Pricing/quota (vision tokens cost more than text).

**Sequencing:** AFTER beta launches on the solid prose → branch/SMB flow, so
real tester feedback shapes the confidence/review UX (the make-or-break part).

## BACKLOG (feature, from tester feedback): WAN edge — MPLS / dual-circuit — NOT STARTED

**Origin:** tester (2026-07) asked for a branch that connects to the main data
centre over **two MPLS circuits**. The LAN half (50 users, a phone each →
voice VLAN, 4 cameras segregated into their own VLAN) composed well and the
tester was happy — but there is **no WAN/MPLS modeling anywhere**: no
design-params field for circuits/WAN uplinks/DC connectivity, and the branch
composer only builds the LAN + an internet edge. The WAN requirement is
currently only *surfaced as an assumption* (see the extractor change below),
not designed. This item is to make it a real, first-class capability.

**Scope (a "WAN edge" the branch/campus edge can attach to):**
1. **schema/design-params**: a `wan` block — one or more circuits, each with
   `type` (mpls | internet | broadband | lte), `provider?`, `bandwidth?`, and
   a redundancy intent (active/active vs active/standby); plus the remote
   endpoint (hub/data-centre) it targets.
2. **schema/design**: model WAN circuits as links to a provider-edge / hub
   node (or an abstract "WAN cloud" device role), with PE-CE addressing from
   the engine (deterministic, like every other subnet).
3. **design-engine composer**: place the CE router(s), attach circuits, and
   apply the chosen redundancy pattern (dual-CE or single-CE dual-circuit).
4. **routing (needs founder sign-off — networking decision):** PE-CE routing
   default — **BGP vs static** to the provider, and **active/active (both
   circuits load-share) vs active/standby (primary + backup)**. These two
   choices define the feature; do not pick them silently.
5. **DESIGN-DECISIONS GATE (required UX — founder asked for this explicitly):**
   when a WAN/MPLS scenario is detected, the tool must **pause before rendering
   the design + base configs and ask the user to choose** (a) static vs BGP and
   (b) active/active vs active/standby, each with a sensible pre-selected
   default and a one-line explanation. Only after the user confirms does it
   compose + render. Mechanism: generalize the existing clarify path — the
   extractor already returns a 422 `needsClarification` with questions; add a
   parallel **`design_decisions`** shape (id, prompt, options[], default) that
   the extractor emits when a decision-bearing requirement is detected, the UI
   renders as a choice card, and the answers feed back into the `wan` params on
   the follow-up call. Keep it generic so future features (SD-WAN, QoS, HA
   modes) reuse the same gate — do NOT hard-code it to WAN.
6. **config-gen**: cisco-ios CE template (circuit interfaces + BGP or static +
   redundancy, driven by the gate's answers) — its own reviewed increment, same
   discipline as the campus templates.
7. **llm-extraction + tests**: extend the prompt/few-shots so a stated WAN is
   captured into the new `wan` params (instead of the "Not yet modeled:"
   assumption once this ships); golden fixture + compose/config tests.

**DONE — "Not yet modeled" analytics tally (shipped):** the extractor already
marks unmodeled requirements with a "Not yet modeled:" assumption; the web
generate + regenerate routes now emit one PostHog **`design_unmodeled_requirement`**
event per item (properties: `requirement`, `source`, `project_id`) plus
`unmodeled_count` / `unmodeled_requirements` on the `design_generated` /
`design_regenerated` events. Break down `design_unmodeled_requirement` by
`requirement` in PostHog to rank the most-requested out-of-scope features — a
data-driven build queue. Marker + extraction logic live in
`apps/web/lib/unmodeled.ts` (`UNMODELED_PREFIX`).

**Sequencing:** after beta feedback confirms demand (this is the first data
point). It's the natural next composer-shaped feature — same pattern as
branch → campus. Depends on the founder answering the routing defaults in (4).

## BACKLOG (LAST — after other feedback-driven features): knowledge ingestion pipeline — NOT STARTED

**Priority: deliberately last.** Build only after the feedback-driven features
(WAN edge, sketch upload, additional vendors/patterns) land. Founder's call
(2026-07): capture now so it isn't forgotten, sequence it at the end.

**Goal:** let uploaded reference material — vendor whitepapers, best-practice
design guides, and real base configs (small-office → enterprise) — *accelerate
the deterministic layer*, WITHOUT ever becoming a runtime config generator.
Protects the moat: the LLM still only proposes params/design intent; the engine
still disposes (deterministic IP/VLAN, template-render-only configs).

**Two ingestion tracks — both feed reviewed, tested artifacts, never raw output:**
1. **Whitepapers / best-practice design docs → design rules + extraction context.**
   Use them to (a) encode design rules into `packages/design-engine` (sizing,
   redundancy, segmentation) and (b) optionally a RAG layer on the
   *intent-extraction* stage so prose → params → assumptions reflect vendor best
   practice. Improves *what the engine is told to build*; the engine still does
   the math.
2. **Reference base configs (uploaded) → drafted-and-tested templates.** An
   uploaded config becomes source material: the LLM DRAFTS a new
   `packages/config-gen` template → human review → golden test → ship. This is
   the CLAUDE.md-sanctioned path ("LLM may draft a NEW template for human review,
   but runtime config generation is template-render only") and the fastest way to
   expand vendor/scenario coverage.

**Hard guardrails (non-negotiable, from CLAUDE.md):**
- NEVER feed whitepapers/configs to the LLM to emit configs at request time —
  that reintroduces hallucination, breaks determinism + validation, and kills the
  "not a chatbot guessing" positioning.
- NEVER render a user's uploaded config verbatim (unvalidated/untrusted). It's
  input to the template-authoring pipeline, not output.
- Every generated template still begins with the mandated lab-validation banner
  and must pass a golden test before shipping.

**Scope when picked up:** upload UI + private per-owner storage (Supabase);
an ingestion/review workflow (draft → human approve → test → publish); provenance
tracking (which template/rule came from which source); and the extraction-side
RAG index. Sizeable — treat as a mini-project, not a single increment.

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
