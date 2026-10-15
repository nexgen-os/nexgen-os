-- Nexgen OS — module `sharing`: the allocation keys of a sharing, as data,
-- and its runs through an engine.
--
-- Energy sharing — self-consumption on a site, a community sharing what its
-- producers inject among its consumers — is computed by an engine of the
-- `energy_sharing` kind (engines/README.md, decision 0013): a program that
-- reads the participants' offtake and injection, an allocation key and the
-- rules of the country or the project, and answers what each participant
-- received from the sharing and gave to it, step by step. Whoever shares
-- energy writes their own key in their own engine; this module keeps the
-- model — which key a project applies over which period — and records each
-- computation as a run whose series are the core's, on the participants
-- (`modules/sharing/run.ts`).

set search_path = nexgen, public, extensions;

create schema if not exists sharing;
grant usage on schema sharing to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- allocation_keys — how a project shares, over a period.
-- ---------------------------------------------------------------------------

create table sharing.allocation_keys (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  name             text not null,
  -- The method an engine knows (`proportional`, `fixed`, `ordered`, or one
  -- of its own) and its parameters, as the engine reads them: shares per
  -- participant, an order of priority, a basis. Nothing here interprets them.
  method           text not null,
  parameters       jsonb not null default '{}'::jsonb,
  -- The dates the key holds, `valid_to` excluded: the key a general
  -- assembly voted for a year. Null bounds are open.
  valid_from       date,
  valid_to         date,
  -- Where it comes from: the statutes, a decision; the document itself
  -- attaches to the project.
  source           text,
  document_id      uuid references documents(id) on delete set null,
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint allocation_keys_name_not_blank check (btrim(name) <> ''),
  constraint allocation_keys_method_format check (method ~ '^[a-z][a-z0-9_]*$'),
  constraint allocation_keys_parameters_object check (jsonb_typeof(parameters) = 'object'),
  constraint allocation_keys_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table sharing.allocation_keys is
  'How a project shares energy among its participants over a period: a method an engine knows and its parameters, kept as data with its source. An energy_sharing engine interprets it.';

create index allocation_keys_project_idx on sharing.allocation_keys (project_id);

-- A key is of the organisation of its project.
create or replace function sharing.allocation_keys_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from projects p where p.id = new.project_id and p.organisation_id = new.organisation_id) then
    raise exception 'project_in_other_organisation: %', new.project_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger allocation_keys_check
  before insert or update of project_id, organisation_id on sharing.allocation_keys
  for each row execute function sharing.allocation_keys_check();

call secure_table('sharing.allocation_keys');

-- ---------------------------------------------------------------------------
-- Quantities an energy_sharing engine answers, beside the core's offtake and
-- injection.
-- ---------------------------------------------------------------------------

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by) values
  ('shared_offtake_energy',   'Energy received from a sharing', 'KiloW-HR', 'sum', 'Energy', 'The part of a participant''s offtake covered by energy shared within its project.', 'sharing'),
  ('shared_injection_energy', 'Energy given to a sharing',      'KiloW-HR', 'sum', 'Energy', 'The part of a participant''s injection shared with the other participants of its project.', 'sharing');

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('sharing', 'Sharing', '0.1.0', 'sharing', '0.1.0',
        'The allocation keys of a project as data, and energy sharing computed by an engine of the energy_sharing kind, recorded as runs with series on the participants.')
on conflict (code) do update set version = excluded.version, schema_name = excluded.schema_name, description = excluded.description;
