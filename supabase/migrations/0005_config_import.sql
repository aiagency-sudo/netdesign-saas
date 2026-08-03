-- Config-to-design import (brownfield). Adds the two things an imported
-- project needs beyond a generated one:
--
--   source_configs  the uploaded configuration files, stored VERBATIM. Per the
--                   feature's scope rule, the client's configuration is the
--                   source of truth and is never rewritten — so we keep it and
--                   let the user read it back alongside the documentation.
--   findings        advisory observations produced by config-parse. Kept in a
--                   separate column, never merged into design_json, because
--                   design_json must stay valid against design-schema.json and
--                   findings are commentary about the upload, not design data.
--
-- Additive only: existing prompt-generated projects leave both null and every
-- current read site keeps working unchanged.

alter table public.projects
  add column if not exists source_configs jsonb,
  add column if not exists findings jsonb;

-- Distinguishes how a project was created, so the UI can label an imported
-- project and skip prompt-only affordances (e.g. Regenerate, which would be
-- meaningless — there is no prompt to re-run, and regenerating must never
-- replace the user's uploaded configuration).
alter table public.projects
  add column if not exists source_kind text not null default 'prompt';

alter table public.projects
  drop constraint if exists projects_source_kind_check;

alter table public.projects
  add constraint projects_source_kind_check
  check (source_kind in ('prompt', 'config-import'));

-- Versions carry the findings for that particular import too, so history stays
-- meaningful when a project is re-imported with more device configs.
alter table public.project_versions
  add column if not exists findings jsonb;

-- RLS is unchanged: both tables already restrict to the owning user
-- (0001_init.sql / 0002_project_versions.sql), and these are new columns on
-- those same rows.
