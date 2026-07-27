-- Landing-page waitlist (pre-beta interest capture). Anonymous visitors on
-- the marketing landing page ("/") can add their email; the founder reads the
-- list from the Supabase dashboard (service role bypasses RLS). No SELECT
-- policy is defined on purpose, so the anon/authenticated API roles can insert
-- but can never read the list back out.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,
  created_at timestamptz not null default now()
);

-- Case-insensitive dedupe: joining twice with the same email is a no-op, not
-- a duplicate row (the API route treats the unique violation as success).
create unique index if not exists waitlist_email_unique_idx
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

create policy "Anyone can join the waitlist"
  on public.waitlist for insert
  to anon, authenticated
  with check (true);
