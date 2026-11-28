-- Nexgen OS — the schema this release defines is 0.6.0.
--
-- `nexgen_schema_version()` is what a package reads to decide whether it can
-- work with this database (docs/releasing.md). Between 0.5.0 and here a
-- device moves through the works by named transitions
-- (`set_device_status()`), the installed power of a participant or a project
-- is read from its devices (`installed_power()`), the series an amount of a
-- participant is read from is chosen along one path (`participant_series()`),
-- and a derogation to the distance of an energy sharing operation is an
-- attribute type of its own: a package of 0.6.0 reads them. This migration
-- redefines the function and does nothing else.

set search_path = nexgen, extensions;

create or replace function nexgen_schema_version()
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select '0.6.0'::text;
$$;
