-- Nexgen OS — module `community`: what energy sharing reads and writes.
--
-- Decision 0041: who takes part in a project and who received how much are
-- the same participants, so energy sharing lives here. The allocation key
-- of a project is an attribute of the project, with its period and its
-- source (the general assembly that voted it); what a key reads about one
-- participant (a fixed share, a rank) is an attribute of the participant.
-- Nothing here interprets a key: an engine of the `energy_sharing` kind
-- does (packages/connectors/README.md, decision 0013), and its answer comes back as a
-- settlement (`community.settlements`): the sharing of a project over a
-- period, for all its participants, whose series are on the participants
-- (`modules/community/src/sharing.ts`).

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- settlements — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table community.settlements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The project whose energy was shared.
  project_id       uuid not null references projects(id) on delete cascade,
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table community.settlements is
  'The settlements of a project: the sharing of its energy over a period among all its participants, with its inputs, its provenance (the program and version that computed it) and its results; the series a settlement wrote name it in their source. A new computation adds a settlement or replaces one.';

create index settlements_project_id_idx on community.settlements (project_id);
create trigger settlements_set_updated_at before update on community.settlements
  for each row execute function set_updated_at();
call secure_table('community.settlements');

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
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
       description = 'Energy sharing among the participants of a project of the core: the allocation key of the project and what it reads about each participant, as attributes, and the shares an engine computes, recorded as settlements.'
 where code = 'community';
