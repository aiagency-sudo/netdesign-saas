# NetDesign.app — Step-by-Step Build Plan (20 hrs/week, Claude Code as the engine)

Each "session" = one 2–3 hour block. Prompts in quotes are literal — paste them
into Claude Code. Weekend blocks are for testing against real tools (Visio,
draw.io) and community work, not coding.

Prerequisites (one evening): install Claude Code + Node 20 + pnpm + Python 3.11;
create free accounts: GitHub, Supabase, Vercel, Railway; buy a domain (~$15).
Put CLAUDE.md and design-schema.json at the repo root before your first session.

---

## Progress against plan (what's actually shipped) — updated 2026-07

Detailed session-by-session notes live in **TODO.md**; this is the at-a-glance
roadmap view.

- **Phase 0 — DONE.** schema + deterministic design-engine (IP allocation,
  branch-office/smb-flat composers), .vsdx service (Railway), G1/G4 golden tests.
- **Phase 1 (walking skeleton) — DONE.** Next.js app on Vercel, Supabase auth
  (magic link) + Postgres, LLM intent extraction, live generate, IP-Plan/
  Device-List/Assumptions tabs, .vsdx download, design versioning
  (regenerate/restore), HLD (.docx) doc-gen, cisco-ios config-gen + Download
  configs.
- **Hardening — DONE.** Clarifying-question handling, per-user generation rate
  limiting, PostHog analytics (funnels live), golden suite re-confirmed.
- **Pulled forward from Phase 3:** the marketing **landing page + waitlist** and
  a **warm editorial rebrand** (landing + in-app diagram) are built and live;
  custom domain `app.jactictservices.com` wired (Vercel + Hostinger DNS + Resend
  SMTP + Supabase auth URLs).
- **Phase 2 vendor rollout — fortinet-fortigate DONE (ahead of schedule),
  founder-reviewed. paloalto-panos DONE, awaiting founder line-by-line review**
  (see Session 16 below). That closes Phase 2's vendor list.
- **Pulled forward from the brownfield backlog:** the **campus three-tier**
  composer (G2: core + distribution + L2 access, HSRP SVIs, OSPF) and
  **config-to-design import** (`packages/config-parse` + upload UI) are built.
- **Next up:** Phase 2 beta recruiting + watch the PostHog funnels; then pick
  the next feature from the brownfield-vs-vendor-rollout weighing in TODO.md.

---

## PHASE 0 — Prove the moat (Week 1–2, ~4 sessions)
Goal: prompt → design JSON → .vsdx that opens cleanly. No UI. If this fails,
stop and rethink — you will have spent 2 weeks, not 6 months.

- Session 1: "Read CLAUDE.md and design-schema.json. Scaffold the monorepo
  (pnpm workspaces) with packages/schema (zod validators generated from the
  JSON schema + unit tests) and packages/design-engine with one rule module:
  deterministic IP allocation (site supernet → VLAN /24s, P2P /31s, loopbacks
  /32s, mgmt net). Write tests proving zero overlaps on golden scenario G1."
- Session 2: "Build the LLM extraction module: Claude API call that turns user
  prose into design-params JSON (few-shot with 3 examples), then the engine
  composes the full design JSON for pattern branch-office. Validate against the
  schema. Add golden scenarios G1 and G4 as fixtures with snapshot tests."
- Session 3: "Create services/vsdx: FastAPI with POST /export taking design
  JSON, using the vsdx Python library to build a diagram — shapes per device
  role, connectors per link, and embed device properties as Visio shape data.
  Include a structural validator (unzip, check XML parts) and pytest."
- Session 4: Wire engine → vsdx service end-to-end via a CLI script.
  WEEKEND GATE: open the G1 and G4 exports in real Visio (or Visio web viewer),
  draw.io, and LibreOffice Draw. Judge: would you hand this to a client after
  ≤15 min of cleanup? If no — spend Phase 0.5 fixing export quality before ANY
  UI work. Export quality is the moat.

## PHASE 1 — Walking skeleton (Week 3–6, ~8 sessions)
Goal: a deployed web app a stranger can use.

- Sessions 5–6: "Build the Next.js app: Supabase auth (email magic link),
  projects table, a prompt page that calls the pipeline, and a React Flow
  canvas rendering the design JSON with role-based node icons and zone
  grouping. Deploy to Vercel; deploy services/vsdx to Railway."
- Sessions 7–8: "Add the design detail view: interactive diagram + tabbed
  panels for IP Plan (table from segments/links), Device List, and Assumptions.
  Add Download .vsdx. Add design versioning: each regenerate saves a new
  version row; list + restore."
- Session 9: "Implement the HLD document generator: design JSON → structured
  markdown (overview, assumptions, topology, IP plan, VLAN table, routing,
  security zones) with docx export."
- Session 10: FIRST CONFIG VENDOR. "Create packages/config-gen with a
  nunjucks template set for cisco-ios: hostname, VLANs, SVIs, trunks/access
  ports, OSPF, HSRP, default route, NAT overload, and the lab-validation
  banner. Render per-device configs from design JSON. Snapshot-test against
  G1 and G4. Templates only — no LLM at render time."
- Sessions 11–12: Hardening. "Add generation error handling (LLM returns
  clarifying questions when intent is ambiguous instead of guessing), rate
  limiting, PostHog events (signup, generate, export, config-download), and
  run the full golden suite G1–G5."
  WEEKEND GATE: You personally run 10 realistic scenarios from your own work
  history. Fix the top 3 failure modes before inviting anyone.

## PHASE 2 — Private beta with real engineers (Week 7–10)
Goal: 15–30 testers; brutal feedback; the config feature validated.

- Recruiting (weekend, ~3 hrs): post in r/networking, r/ccna, Packet Pushers
  Slack, LinkedIn. Template:
  "I'm a network engineer building a tool that turns a plain-English
  requirement ('branch office, dual routers with HSRP, guest wifi, FortiGate
  edge') into a validated design + Visio file + base configs. I need 20
  engineers to try to break it. Free lifetime Pro for beta testers who give
  weekly feedback. DM me."
  Engineers love breaking things — lean into that framing.
- Onboard in batches of 5 (personal email each, ask for their gnarliest
  real-world scenario). Instrument everything; watch PostHog session funnels.
- Sessions 13–18: fix what testers break, in order of frequency. Expect the
  top issues to be: intent misread (improve extraction few-shots), layout
  ugliness in vsdx, and config edge cases.
- Session 16 (parallel): SECOND + THIRD VENDORS by tester vote — likely
  "Add fortinet-fortigate and paloalto-panos template sets to config-gen,
  same test discipline as cisco-ios. Map neutral interface names correctly
  (port1, ethernet1/1)."
  * **fortinet-fortigate — DONE** (edge firewall base config: WAN as DHCP
    client, static inside ports, ECMP static routes to each VLAN subnet via
    both HSRP routers, no policies; founder-reviewed the rendered G1 output).
  * **paloalto-panos — DONE, pending founder review** (edge firewall base
    config in `set` format: ethernet1/1 as DHCP client, static inside ports,
    untrust/trust zones, ECMP static routes to each VLAN subnet via both HSRP
    routers, no security policies and no NAT — the same posture approved for
    FortiGate). Review checklist is in TODO.md.
- BETA EXIT CRITERIA (do not charge money before these):
  * ≥70% of testers: vsdx opens cleanly, ≤15 min cleanup
  * ≥50% of testers who downloaded a config say it's a usable starting point
  * ≥5 testers say unprompted they'd pay $39/mo
  * ≥3 testers used it on a REAL engagement

## PHASE 3 — Monetize & public launch (Week 11–14)
- Sessions 19–20: "Integrate Stripe Checkout + customer portal + webhook →
  Supabase subscription state. Gate .vsdx and config downloads to Pro; free
  tier gets 3 designs/mo and watermarked PNG. Flag all billing code for my
  review." (Review it yourself. Test with Stripe test cards.)
- Session 21: Landing page — headline "From requirements to a validated
  network design, Visio file, and base configs in minutes." Embed a 4-minute
  screen-recorded demo (record it yourself; engineers trust unpolished-real
  over slick).
- Session 22: Launch assets — Product Hunt listing, Show HN post, 3 SEO
  articles ("network design document template", "generate Visio network
  diagram from text", "FortiGate base config generator").
- Launch sequence: beta testers first (they're your first reviews) → Product
  Hunt Tuesday → Show HN Thursday → community follow-ups.
- Target: 10 paying customers in 30 days. That's proof of demand — then the
  roadmap (Aruba/Arista, Terraform for hybrid cloud, Team tier, NetBox sync)
  is driven by paying-user votes, not guesses.

---

## Config generation — the discipline that keeps you credible
1. LLM extracts intent → design JSON. Templates render configs. Never let the
   LLM free-write config at runtime; that's where IP conflicts and mixed
   vendor syntax come from.
2. When adding a vendor, have Claude Code DRAFT the template set, then YOU
   review every line — you're the domain expert; this review is non-negotiable.
3. Every vendor ships with snapshot tests against all golden scenarios.
4. Every output carries the "validate in a lab" banner. Position configs as
   "base configs / starting points" everywhere — honest and industry-normal.
5. Cloud & hybrid = Terraform output (aws/azurerm providers), not CLI. It's a
   Phase-4 feature; don't let it creep earlier.

## Weekly rhythm (the 20 hours)
Mon/Tue/Thu evenings (3 × ~2.5h): Claude Code build sessions.
Sat (~6h): testing against Visio/draw.io + one community/content block.
Sun (~2h): plan next week, update TODO.md, reply to beta testers.
Rule: end every session with tests green and TODO.md current — your next
session's first prompt is always just "Read TODO.md and continue."
