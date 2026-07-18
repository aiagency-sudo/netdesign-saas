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
`len(devices) + len(renderable_links)`; the `<Connects>` count equals
`2 * len(renderable_links)` (each connector glues at both ends); and every
device has a shape whose Shape Data actually matches that device's id, role,
and vendor — not just that *some* shape exists.

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
pytest                          # 32 tests: models, builder, validator, API
```

## Known upstream issues worked around here

- **Duplicate `<Override>`/`<Relationship>` entries broke draw.io import.**
  `vsdx==0.6.1`'s `Connect.create()` bootstraps the connector master's
  `[Content_Types].xml` `<Override>` and `visio/_rels/document.xml.rels`
  `<Relationship>` entries by checking `os.path.exists(page.vis._masters_folder)`
  — a real-filesystem check that's never actually true in this in-memory-zip
  flow, so the bootstrap re-runs and re-appends on *every single* connector
  instead of only the first. A design with 5 link connectors (G1) ended up
  with 6 duplicate `<Override>` entries for the same `PartName` — invalid
  per the OPC spec (ECMA-376 Part 2 §10.1.2.2.1: at most one `Override` per
  part) — even though `vsdx`'s own parser round-trips it without complaint.
  draw.io's importer does not tolerate this and fails with "Cannot read
  properties of null (reading 'getElementsByTagName')" on open.
  `_dedupe_opc_metadata()` in `vsdx_builder.py` collapses both files to one
  entry per part/relationship as a post-save pass, and
  `structural_validator.py`'s `_check_opc_metadata_integrity()` independently
  flags any duplicates that creep back in — regression-tested in
  `tests/test_structural_validator.py` (`test_g1_and_g4_outputs_have_no_duplicate_opc_metadata`
  and friends). Confirmed fixed by re-exporting G1 and checking
  `[Content_Types].xml`/`document.xml.rels` by hand.
- `Connect.create()` also builds `BegTrigger`/`EndTrigger` glue formulas with
  a string `.replace()` that drops a `.` (producing `Sheet1!` instead of
  `Sheet.1!`). `_fix_connector_trigger_formulas()` corrects this after every
  connector is created — the `<Connect>` elements vsdx itself round-trips on
  aren't affected, but a real Visio's live re-glue tracking likely is.
