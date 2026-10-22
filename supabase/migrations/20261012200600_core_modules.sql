-- Nexgen OS — core: the modules installed.
--
-- A module computes — PV production, a consumption curve, the sharing of a
-- community — in its own schema, and keeps there what it computed, in a
-- plain table named after what it holds (`solar.estimates`,
-- `consumption.estimates`, `community.settlements`). A figure says where it
-- comes from (decision 0004): each row names its subject by a foreign key to
-- an object of the core, and keeps the inputs it read, its provenance — the
-- program and the version that computed it — and its results; the series it
-- wrote name the row in their source (`<module>.<table>:<id>`). A new
-- computation adds a row, or replaces one. The core keeps no figure and no
-- gesture of its own for them: each module writes its rows with its own
-- function. Nothing in the core calls a model; a module that uses one says
-- so in the provenance and the inputs.
--
-- The shape of such a table, in the module's migration (`<table>` is the
-- word of what it holds: `estimates`, `settlements`):
--
--   create table <module>.<table> (
--     id               uuid primary key default gen_random_uuid(),
--     organisation_id  uuid not null references organisations(id) on delete cascade,
--     <kind>_id        uuid not null references <the kind's table>(id) on delete cascade,
--     provenance       text not null,
--     inputs           jsonb not null,
--     results          jsonb not null,
--     created_at       timestamptz not null default now(),
--     updated_at       timestamptz not null default now());
--   create trigger <table>_set_updated_at before update on <module>.<table>
--     for each row execute function set_updated_at();
--   call secure_table('<module>.<table>');

set search_path = nexgen, public, extensions;

create table modules (
  code              text primary key,
  name              text not null,
  version           text not null,
  -- The Postgres schema the module owns. The core has no idea what is in it.
  schema_name       text not null unique,
  requires_core_min text not null,
  description       text,
  installed_at      timestamptz not null default now(),
  constraint modules_code_format check (code ~ '^[a-z0-9][a-z0-9_]*$')
);

comment on table modules is
  'Modules installed beside the core, one Postgres schema each. A module''s first migration writes its row here.';

alter table modules enable row level security;
create policy modules_read on modules for select to authenticated using (true);
grant select on modules to authenticated;
grant select, insert, update, delete on modules to service_role;
