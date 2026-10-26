-- Nexgen OS — the schema this release defines is 0.4.0.
--
-- `nexgen_schema_version()` is what a package reads to decide whether it can
-- work with this database (docs/releasing.md). Between 0.3.0 and here a value
-- says its quality (`value_quality`, read as `assumed` for a default of
-- 0.3.0), a project's kind is its frame or none, a participant says its
-- category, and a region names the region it is part of by its `parent_code`:
-- a package of 0.4.0 reads them. This migration redefines the function and
-- does nothing else.

set search_path = nexgen, extensions;

create or replace function nexgen_schema_version()
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select '0.4.0'::text;
$$;
