-- Nexgen OS — module `community`: what energy sharing reads and writes.
--
-- Decision 0041: who takes part in a project and who received how much are
-- the same participants, so energy sharing lives here. The allocation key
-- of a project is an attribute of the project, with its period and its
-- source (the general assembly that voted it); what a key reads about one
-- participant (a fixed share, a rank) is an attribute of the participant.
-- Nothing here interprets a key: an engine of the `energy_sharing` kind
-- does (packages/connectors/README.md, decision 0013), and its answer comes back as a
-- run of this module (`community.runs`) whose series are on the participants
-- (`modules/community/src/sharing.ts`).

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- runs — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table community.runs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The project whose energy was shared.
  project_id       uuid not null references projects(id) on delete cascade,
  engine_version   text not null,
  inputs           jsonb not null,
  -- sha256 of the table, engine version and inputs: the identity of a result.
  inputs_hash      text not null,
  results          jsonb,
  status           text not null default 'running',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint runs_status check (status in ('running', 'succeeded')),
  constraint runs_finished check ((status = 'running') = (finished_at is null))
);

comment on table community.runs is
  'The sharings the module computed for a project: inputs, engine version, results; the series a run wrote name it in their source. Immutable once finished; same inputs + same engine = same run.';

create unique index runs_one_success_per_input on community.runs (organisation_id, inputs_hash) where status = 'succeeded';
create index runs_project_id_idx on community.runs (project_id);
create trigger runs_is_final before update on community.runs
  for each row execute function run_is_final();
call secure_table('community.runs');


insert into property_defs (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('allocation_key', 'Allocation key',
   'How a project shares energy among its participants: {"method": "<a method an engine knows>", "parameters": {...}}, as the engine reads it.',
   'json', null, null, null, '{project}', 'community'),
  ('allocation_share', 'Allocation share',
   'The fixed share of the energy shared that a participant receives, 0 to 1, read by a key that needs one.',
   'number', 'ratio', 0, 1, '{participant}', 'community'),
  ('allocation_rank', 'Allocation rank',
   'The order a participant is served in by a key that serves in order, 1 first.',
   'integer', null, 1, null, '{participant}', 'community');

-- What an energy_sharing engine answers, beside the core's offtake and
-- injection: the part of each covered by energy shared within the project.
insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by) values
  ('shared_offtake_energy',   'Energy received from a sharing', 'KiloW-HR', 'sum', 'Energy',
   'The part of a participant''s offtake covered by energy shared within its project.', 'community'),
  ('shared_injection_energy', 'Energy given to a sharing',      'KiloW-HR', 'sum', 'Energy',
   'The part of a participant''s injection shared with the other participants of its project.', 'community');

update modules set version = '0.3.0',
       description = 'Energy sharing among the participants of a project of the core: the allocation key of the project and what it reads about each participant, as attributes, and the shares an engine computes, recorded as runs.'
 where code = 'community';
