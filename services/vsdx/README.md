# services/vsdx

The only place Python is used in this repo (per CLAUDE.md). A small FastAPI
service that turns a validated design JSON into a `.vsdx` (Visio) diagram
using the [`vsdx`](https://github.com/dave-howard/vsdx) library. Deployed
separately from the rest of the app (Railway/Fly.io).

## Endpoints

- `POST /export` — body is a design JSON (validated against `app/models.py`,
  a Python mirror of `packages/schema/src/design-schema.json`). Returns the
  `.vsdx` file bytes with `Content-Type: application/vnd.ms-visio.drawing`.
  `422` on a structurally invalid design (missing fields, bad enum, duplicate
  device ids); the error detail is always a human-readable reason, never a
  bare stack trace.
- `GET /healthz` — liveness check for the deploy platform.

## What gets drawn

One rectangle shape per device, fill-colored by role (`app/colors.py`),
labeled with its hostname, laid out on a grid (max 4 columns, wrapping to
new rows; the page grows to fit). Each device's `id`, `role`, `vendorHint`,
`hostname`, `mgmtIp`, `loopback`, and `zone` (whichever are present) are
embedded as Visio **Shape Data** (custom properties — visible in Visio's
Shape Data pane), not just as text.

One connector per link, *provided both ends are devices in the design* — a
link end pointing outside the device list (e.g. an external ISP hop) has no
shape to connect to and is silently skipped (see `renderable_links()` in
`app/vsdx_builder.py`).

Each link endpoint that carries an interface name (design-schema.json's
`deviceId:interface` link format, e.g. `"rtr-01:eth0/1"`) gets a small
borderless port-label shape near that end of the connector — a founder
request after a first-draft diagram shipped with unlabeled links. Position
is computed from the two device shapes' own coordinates (`_port_label_position()`
in `vsdx_builder.py`), offset toward the link partner and clamped to never
overshoot the midpoint on short links (e.g. adjacent grid cells). A
device's links don't always point in different directions — e.g. every
device in a grid layout's rightmost column points left toward everything
else — so `_port_label_position()` also takes that interface's own `eth0/N`
index and nudges perpendicular to the line by an amount that strictly grows
with `N`, guaranteeing two labels at the same device can never land on the
same point (a real bug caught by founder review: G1's `sw-02` had its
`rtr-02`-facing and `sw-01`-facing labels compute to an identical
coordinate, silently hiding one under the other).

VLAN/segment data is accepted (and validated) but not yet drawn onto the
diagram — out of scope for this session; see TODO.md.

## Why a checked-in template (`app/templates/blank.vsdx`)

`vsdx.VisioFile(path)` can only *open* an existing file — there's no
"create blank" API. Every export starts from `app/templates/blank.vsdx`
(copied to a throwaway temp path per request, never mutated in place) and
adds shapes/connectors from there. That template is itself generated *by*
the vsdx library — see `app/templates/generate_blank_template.py` — from
vsdx's own bundled `media.vsdx` demo file with its one shape and connects
stripped out, rather than hand-built from scratch, because a truly
from-scratch minimal OOXML zip is missing pieces (`windows.xml`,
`docProps/thumbnail.emf`, StyleSheets/theme/font tables) that
`vsdx.Connect.create()` reads and mutates when it lazily bootstraps the
connector master the first time a connector is added to a page. Regenerate
it only if the `vsdx` dependency version changes:

```
python -m app.templates.generate_blank_template
```

## Structural validation (`app/structural_validator.py`)

`validate_vsdx_structure(vsdx_bytes, design)` unzips the output and checks:
required OOXML parts are present (`[Content_Types].xml`,
`visio/pages/page1.xml`, etc.); the page's top-level shape count equals
`devices + renderable_links + port_labels` (port labels: one per link
endpoint that carries an interface name); the `<Connects>` count equals
`2 * len(renderable_links)` (each connector glues at both ends); every
device has a shape whose Shape Data actually matches that device's id, role,
and vendor — not just that *some* shape exists; and every expected
port-label text appears on the page at least as many times as it should
(`Counter`-based, not mere set membership — interface names restart per
device, so "eth0/0" legitimately appears on every device's first link, and
a naive "does this text exist anywhere" check can't tell a genuinely
missing label from one of its many same-text siblings elsewhere on the
page).

This is not the same thing as the golden-file `.vsdx` comparison CLAUDE.md
describes (`tests/golden/*.vsdx`, comparing against real exports once
they've been opened in actual Visio) — that's a Session-4 weekend-gate
concern, once export *quality* is being judged, not just export
*structure*.

## Local development

```
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload   # serves on http://127.0.0.1:8000
pytest                          # 40 tests: models, builder, validator, API
```

## Known upstream issues worked around here

`vsdx`'s own (lenient) parser round-trips its own output fine, but draw.io's
importer does not — it failed on the very first real-world test with
"Cannot read properties of null (reading 'getElementsByTagName')" on open.
Two independent bugs in `vsdx==0.6.1` caused it; both are fixed as a
post-save pass in `_repackage()` (`vsdx_builder.py`) and independently
regression-checked in `structural_validator.py`.

- **Auto-generated `ns0:` namespace prefixes broke every tag/attribute match
  draw.io's importer does.** This was the one that actually mattered — the
  duplicate-metadata fix below shipped first and was *not* sufficient on its
  own; the founder retried the export in draw.io and hit the identical
  error, which is what led to finding this one. `vsdx` never calls
  `ET.register_namespace()`, so Python's `xml.etree.ElementTree` falls back
  to auto-generated prefixes (`ns0`, `ns1`, ...) for every part it
  re-serializes: `<ns0:PageContents>` instead of the `<PageContents
  xmlns="...">` real Visio produces. `vsdx`'s own parser resolves elements
  by namespace-qualified `{uri}localname`, so it doesn't notice or care.
  draw.io's importer (traced from
  `github.com/jgraph/drawio/src/main/webapp/js/diagramly/vsdx/importer.js`,
  since this couldn't be reproduced locally — see below) matches tags and
  attributes as **bare string literals** instead: `child.tagName ===
  "PageContents"`, `relsDoc.getElementsByTagName("Relationship")`,
  `rel.getAttribute("r:id")`. Every one of those silently returns
  null/empty against a prefixed tag, and something downstream calls
  `.getElementsByTagName` on that null — hence the exact error reported.
  The fix isn't a single upfront `ET.register_namespace("", uri)` call:
  that's a *global* slot (keyed by URI, but only one URI can hold the
  empty-string prefix at a time — each call evicts whichever namespace
  held it before), and `vsdx.save_vsdx()` serializes multiple
  differently-namespaced parts (Visio content, OPC relationships,
  content-types) within one call. `_repackage()` instead walks every
  `.xml`/`.rels` part in the *saved* zip and re-registers the *correct*
  namespace as default immediately before re-serializing *that specific
  part*, so each part gets its own namespace back as the unprefixed
  default — matching what real Visio produces. Regression-tested by
  `structural_validator.py`'s `_check_no_generated_namespace_prefixes()` on
  every namespace-sensitive part (everything under `visio/`,
  `[Content_Types].xml`, all `.rels` files) and
  `tests/test_structural_validator.py::test_g1_and_g4_outputs_have_no_generated_namespace_prefixes`.
- **Duplicate `<Override>`/`<Relationship>` entries.** `Connect.create()`
  bootstraps the connector master's `[Content_Types].xml` `<Override>` and
  `visio/_rels/document.xml.rels` `<Relationship>` entries by checking
  `os.path.exists(page.vis._masters_folder)` — a real-filesystem check
  that's never actually true in this in-memory-zip flow, so the bootstrap
  re-runs and re-appends on *every single* connector instead of only the
  first. A design with 5 link connectors (G1) ended up with 6 duplicate
  `<Override>` entries for the same `PartName` — invalid per the OPC spec
  (ECMA-376 Part 2 §10.1.2.2.1: at most one `Override` per part). This
  alone doesn't explain the draw.io failure (see above — the namespace
  issue does), but it's real and independently worth fixing.
  `_repackage()` collapses both files to one entry per part/relationship,
  and `structural_validator.py`'s `_check_opc_metadata_integrity()`
  independently flags any duplicates that creep back in.
- `Connect.create()` also builds `BegTrigger`/`EndTrigger` glue formulas with
  a string `.replace()` that drops a `.` (producing `Sheet1!` instead of
  `Sheet.1!`). `_fix_connector_trigger_formulas()` corrects this after every
  connector is created — the `<Connect>` elements vsdx itself round-trips on
  aren't affected, but a real Visio's live re-glue tracking likely is.

### How this was actually debugged

This session's network policy blocks `app.diagrams.net`, so a live
browser-driven repro wasn't possible. Root-caused instead by fetching
draw.io's real (non-minified-away) importer source directly from GitHub
(`jgraph/drawio`, `dev` branch) and grepping every `getElementsByTagName`
call site to find which one could plausibly receive `null` given this
file's exact structure — landing on `mxVsdxPage.prototype.resolveRel`,
which looks for a child literally named `PageContents` by bare
`tagName` comparison. Confirmed by diffing which of our own output files
were namespace-prefixed (the ones `vsdx` re-serializes: `document.xml`,
`page1.xml`, `pages.xml`, `pages.xml.rels`) versus which weren't (the ones
copied byte-for-byte from the original `media.vsdx`: `masters.xml`,
`windows.xml`) — a clean, checkable signal that this was specifically a
*re-serialization* artifact, not something inherent to the file format.
