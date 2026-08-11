-- Sketch/diagram import: a third way a project can come into existence.
--
-- A sketch-imported project reuses the columns 0005 already added rather than
-- inventing parallel ones:
--
--   findings       the RECOMMENDED CORRECTIONS from reading the diagram. Same
--                  advisory shape as config-import findings (the type now
--                  lives in packages/schema and is shared by both producers),
--                  so one column and one UI serve both. Critically these are
--                  never applied to design_json — the design describes what
--                  was drawn; the recommendations are the engineer's to accept
--                  or reject.
--   source_configs the uploaded file names and sizes. NOT the file bytes: a
--                  diagram is binary and belongs in object storage, which is a
--                  follow-up. Keeping the manifest here means the project can
--                  still say exactly which files it was built from.
--
-- Additive only: this migration just widens the source_kind check constraint.

alter table public.projects
  drop constraint if exists projects_source_kind_check;

alter table public.projects
  add constraint projects_source_kind_check
  check (source_kind in ('prompt', 'config-import', 'sketch-import'));

-- RLS is unchanged: no new tables, no new columns — both tables already
-- restrict every row to its owning user (0001_init.sql / 0002_project_versions.sql).
