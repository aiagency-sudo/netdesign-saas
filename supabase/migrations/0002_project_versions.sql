-- Design versioning (BUILD_PLAN Session 7-8, item 4): every generate/
-- regenerate appends an immutable row to project_versions. projects.design_json
-- stays a denormalized copy of whichever version is "current" (tracked via
-- current_version_id), so every existing read site (DesignCanvas, IpPlanTable,
-- the .vsdx export route) keeps working unchanged — this migration only adds
-- columns/tables, never removes, and backfills real rows created before this
-- feature existed.

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  design_json jsonb not null,
  prompt text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_versions_project_id_created_at_idx
  on public.project_versions (project_id, created_at desc);

alter table public.project_versions enable row level security;

-- No owner_id column here — ownership is checked by joining back to
-- projects.owner_id, same trust boundary as everything else in this app.
create policy "Owners can select their own project versions"
  on public.project_versions for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.owner_id = auth.uid()
    )
  );

create policy "Owners can insert their own project versions"
  on public.project_versions for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.owner_id = auth.uid()
    )
  );

alter table public.projects
  add column if not exists current_version_id uuid references public.project_versions (id);

-- Backfill: every project that already has a design_json (i.e. every real
-- project created before this migration) becomes version 1 of its own
-- history.
insert into public.project_versions (project_id, design_json, prompt, created_at)
select id, design_json, prompt, created_at
from public.projects
where design_json is not null
  and not exists (
    select 1 from public.project_versions v where v.project_id = projects.id
  );

update public.projects p
set current_version_id = v.id
from public.project_versions v
where v.project_id = p.id
  and p.current_version_id is null
  and v.created_at = (
    select min(v2.created_at) from public.project_versions v2 where v2.project_id = p.id
  );
