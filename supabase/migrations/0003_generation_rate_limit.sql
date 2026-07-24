-- Session 11-12 rate limiting (item 2): without this, a signed-in user
-- calling /api/generate or /api/projects/[id]/regenerate in a tight loop
-- burns Claude API spend with no ceiling. One append-only events table
-- (rather than a per-user counter column) keeps a real audit trail and
-- makes the rolling window just "count rows newer than now() - interval"
-- -- no separate reset/decay logic to get wrong.

create table if not exists public.generation_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists generation_events_owner_id_created_at_idx
  on public.generation_events (owner_id, created_at desc);

alter table public.generation_events enable row level security;

create policy "Owners can select their own generation events"
  on public.generation_events for select
  using (auth.uid() = owner_id);

create policy "Owners can insert their own generation events"
  on public.generation_events for insert
  with check (auth.uid() = owner_id);
