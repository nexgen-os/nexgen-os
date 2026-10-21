-- Nexgen OS — the schema version, and the record of what was applied.
--
-- `nexgen_schema_version()` is what a package reads to decide whether it can
-- work with this database: the installer refuses to run below its floor, and
-- a client says by name that the database is older or newer than itself. A
-- release that adds anything a package reads redefines this function in a
-- migration of its own (docs/releasing.md), and does nothing else in it.
--
-- `schema_migrations` records every file the installer applied — the core's
-- migrations and seed, each module's migrations, each pack's seed — so that
-- a second run applies only what is missing. The installer creates the same
-- table, with the same definition, before the first migration, so that the
-- core migrations that come before this one are recorded too.

set search_path = nexgen, public, extensions;

create or replace function nexgen_schema_version()
returns text
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select '0.3.0'::text;
$$;

comment on function nexgen_schema_version() is
  'The version of the Nexgen OS schema in this database. Packages refuse to run below their floor.';

grant execute on function nexgen_schema_version() to anon, authenticated, service_role;

create table if not exists schema_migrations (
  name        text primary key,
  scope       text not null,
  applied_at  timestamptz not null default now(),
  constraint schema_migrations_scope_format check (scope ~ '^(core|module:[a-z0-9][a-z0-9_]*|pack:[a-z]{2})$')
);

comment on table schema_migrations is
  'Every file the installer applied, by its path in the release: core migrations and seed (scope core), module migrations (module:<code>), pack seeds (pack:<country code>).';

-- Read by the installer and by the service role; no policy for the API roles.
alter table schema_migrations enable row level security;
grant select on schema_migrations to service_role;
