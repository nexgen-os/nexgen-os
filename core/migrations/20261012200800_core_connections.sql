-- Nexgen OS — core: connections, an organisation's use of a source.
--
-- A source says what exists out there (a vocabulary row: a weather model, a
-- grid operator's hub, a register, a map provider). A connection says that
-- this organisation reads it: for what, with which credential — named,
-- never stored — and how the last collection went. The code that reads a
-- source is a connector: a library outside the database, open or private,
-- that implements one of the interfaces under `connectors/`. What a
-- connector brings back lands on ordinary objects, attributes, documents
-- and series, each carrying the source it came from (decision 0011).

set search_path = nexgen, public, extensions;

create table connections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  source_code      text not null references sources(code),
  name             text not null,
  -- What to read: the identifiers, areas, points or mappings the connector
  -- needs, as the connector documents them. No secret here, ever.
  config           jsonb not null default '{}',
  -- The name of the credential in the installation's vault.
  secret_ref       text,
  status           text not null default 'active',
  last_run_at      timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint connections_name_not_blank check (btrim(name) <> ''),
  constraint connections_status check (status in ('active', 'paused', 'error'))
);

comment on table connections is
  'An organisation''s use of a source: what it reads there, the name of its credential, and how the last collection went. The connector that does the reading lives outside the database.';

create index connections_organisation_idx on connections (organisation_id);

create trigger connections_updated before update on connections
  for each row execute function set_updated_at();

call secure_table('connections');
