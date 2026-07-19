-- NetDesign AI: initial schema.
-- Single-owner projects only (auth.uid() === owner_id) — no teams/RBAC yet,
-- per CLAUDE.md's scope guard. No versioning table yet either (BUILD_PLAN
-- Sessions 7-8); design_json is overwritten in place on regeneration.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  prompt text not null,
  design_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_id_created_at_idx
  on public.projects (owner_id, created_at desc);

alter table public.projects enable row level security;

create policy "Owners can select their own projects"
  on public.projects for select
  using (auth.uid() = owner_id);

create policy "Owners can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update their own projects"
  on public.projects for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners can delete their own projects"
  on public.projects for delete
  using (auth.uid() = owner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();
