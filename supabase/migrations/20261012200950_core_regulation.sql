-- Nexgen OS core — the law of a country, as data.
--
-- A country pack is rows, never code: what the law of the country says,
-- where it says it, and who runs its grid. Three tables carry that:
--
--   legal_sources   the texts — a code, a law, a decree, an order, a
--                   regulator's deliberation, a standard — with their
--                   official reference and the consolidated text online;
--   rules           what a text sets, in plain words and in numbers: a
--                   perimeter, a threshold, a share, a deadline, a step,
--                   for a section (grid, energy sharing, compliance,
--                   support, data, addresses), a country and, when the rule
--                   is regional, its regions; every rule names its source
--                   and article, and the dates it holds between;
--   grid_operators  the distribution and transmission operators of the
--                   country and what they cover.
--
-- Modules read them: `tasks` templates name the source they answer,
-- `compliance` will check a project against the rules of its country,
-- `sharing` will read the perimeter and the keys a country admits. Like
-- every vocabulary, they are read by everyone signed in and written by
-- migrations, packs and the installation (`published_by`).

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- legal_sources
-- ---------------------------------------------------------------------------

create table legal_sources (
  code          text primary key,
  name          text not null,
  -- code, law, decree, order (an arrêté), deliberation (a regulator's),
  -- regulation and directive (the Union's), standard, guide, contract_model.
  kind          text not null default 'law',
  -- The official citation, as the country writes it.
  reference     text not null,
  -- The consolidated text online.
  url           text,
  -- Who publishes the text: the official journal, the regulator, the operator.
  publisher     text,
  countries     text[] not null default '{}',
  published_on  date,
  published_by  text not null default 'core',
  description   text,
  constraint legal_sources_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint legal_sources_kind check (kind in ('code', 'law', 'decree', 'order', 'deliberation', 'regulation', 'directive', 'standard', 'guide', 'contract_model'))
);

comment on table legal_sources is
  'The texts the rules of a country come from: codes, laws, decrees, orders, a regulator''s deliberations, standards, with their official reference and the consolidated text online. Vocabulary: written by migrations, packs and the installation.';

alter table legal_sources enable row level security;
create policy legal_sources_read on legal_sources for select to authenticated using (true);
grant select on legal_sources to authenticated;
grant select, insert, update, delete on legal_sources to service_role;

-- ---------------------------------------------------------------------------
-- rules
-- ---------------------------------------------------------------------------

create table rules (
  code               text primary key,
  name               text not null,
  -- addresses, grid, energy_sharing, compliance, support, data.
  section            text not null,
  country            char(2) not null,
  -- ISO 3166-2 codes when the rule holds in part of the country only.
  regions            text[] not null default '{}',
  -- What the rule is about: project, site, building, surface, parking,
  -- device, meter, participant, operator.
  applies_to         text,
  -- The rule in plain words, as a professional would state it.
  statement          text not null,
  -- The rule in numbers, with units in the keys: {"max_distance_m": 2000}.
  parameters         jsonb not null default '{}'::jsonb,
  legal_source_code  text not null references legal_sources(code),
  article            text,
  -- The deep link to the article, when the consolidated text has one.
  url                text,
  valid_from         date,
  valid_to           date,
  published_by       text not null default 'core',
  -- What a maintainer should know: a doubt, a reading to confirm, a change announced.
  notes              text,
  constraint rules_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint rules_section check (section in ('addresses', 'grid', 'energy_sharing', 'compliance', 'support', 'data')),
  constraint rules_country_format check (country ~ '^[A-Z]{2}$'),
  constraint rules_parameters_object check (jsonb_typeof(parameters) = 'object'),
  constraint rules_period check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

comment on table rules is
  'What the law of a country sets, as data: a perimeter, a threshold, a share, a deadline, a step, in plain words and in numbers, for a section, a country and its regions, with the source and article it comes from and the dates it holds between. Vocabulary: written by migrations, packs and the installation.';

create index rules_country_section_idx on rules (country, section);

alter table rules enable row level security;
create policy rules_read on rules for select to authenticated using (true);
grant select on rules to authenticated;
grant select, insert, update, delete on rules to service_role;

-- The rules of a country and a section that hold on a day.
create or replace function rules_on(p_country char(2), p_section text default null, p_on date default current_date)
returns setof rules
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select r.* from rules r
   where r.country = p_country
     and (p_section is null or r.section = p_section)
     and (r.valid_from is null or r.valid_from <= p_on)
     and (r.valid_to is null or r.valid_to >= p_on)
   order by r.section, r.code;
$$;

comment on function rules_on(char, text, date) is
  'The rules of a country, of one section or all, that hold on a day.';

grant execute on function rules_on(char, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- grid_operators
-- ---------------------------------------------------------------------------

create table grid_operators (
  code               text primary key,
  name               text not null,
  -- dso (distribution), tso (transmission), island (a non-interconnected zone).
  kind               text not null,
  country            char(2) not null,
  regions            text[] not null default '{}',
  -- What it covers, in plain words.
  coverage           text,
  website            text,
  -- Where a third party reads meter data with the customer's consent.
  data_hub_url       text,
  -- The scheme of the metering point identifiers it issues.
  identifier_scheme  text references id_schemes(code),
  published_by       text not null default 'core',
  description        text,
  constraint grid_operators_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint grid_operators_kind check (kind in ('dso', 'tso', 'island')),
  constraint grid_operators_country_format check (country ~ '^[A-Z]{2}$')
);

comment on table grid_operators is
  'The distribution and transmission operators of a country, what they cover, where a third party reads meter data and which metering identifier they issue. Vocabulary: written by migrations and packs.';

alter table grid_operators enable row level security;
create policy grid_operators_read on grid_operators for select to authenticated using (true);
grant select on grid_operators to authenticated;
grant select, insert, update, delete on grid_operators to service_role;
