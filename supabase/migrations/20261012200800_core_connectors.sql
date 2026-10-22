-- Nexgen OS — core: connectors, an organisation's use of a source.
--
-- A source says what exists out there (a vocabulary row: a weather model, a
-- grid operator's hub, a register, a map provider). A connector is the code
-- that reads it — a client of an external API or a program in any language,
-- outside the database, open or private, under `packages/connectors/` — and
-- a row of this table is that code configured for one organisation: what it
-- reads, with which credential — named, never stored — and how the last
-- collection went. What a connector brings back lands on ordinary objects,
-- attributes, documents and series, each carrying the source it came from
-- (decision 0011).

set search_path = nexgen, public, extensions;

create table connectors (
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
  last_read_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint connectors_name_not_blank check (btrim(name) <> ''),
  constraint connectors_status check (status in ('active', 'paused', 'error'))
);

comment on table connectors is
  'An organisation''s use of a source through a connector: what it reads there, the name of its credential, and how the last collection went. The code that does the reading lives outside the database.';

create index connectors_organisation_idx on connectors (organisation_id);

create trigger connectors_updated before update on connectors
  for each row execute function set_updated_at();

call secure_table('connectors');
