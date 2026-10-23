-- Nexgen OS — core: vocabularies.
--
-- The objects of the core are named tables: a participant, a meter, a device.
-- What varies inside them is held as data, never as an enum: which kinds of
-- devices exist, which values can be attached and in which unit, which
-- sources and which identifier systems are known. A new kind of thing is a
-- row a module or a country pack publishes, with no migration of the core.
--
-- Every vocabulary row maps to the open standard it comes from:
--
--   device_types       Brick Schema equipment classes, IFC distribution elements
--   attribute_types    buildingSMART Data Dictionary (bSDD), IFC property sets
--   quantities         QUDT quantity kinds and units
--   sources            the external systems data comes from, with their licence
--   identifier_schemes IFC GlobalId, OpenStreetMap, Overture GERS, national registers
--   project_kinds      what a project is: a study, an energy community, and the
--                      legal frames of a country (its pack's rows)
--   segments           the customer segment of a participant: a household, a
--                      business, a public body…
--
-- Vocabularies are shared by every organisation of an installation, read by
-- everyone signed in and written only by migrations and seeds. Each row says
-- who published it: `core`, a module code or a pack code.

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- device_types — what a device can be.
-- ---------------------------------------------------------------------------

create table device_types (
  code            text primary key,
  name            text not null,
  description     text,
  -- The more general type this one refines: an electricity meter is a meter.
  parent_code     text references device_types(code),
  -- The module that derives devices of this type into its own table, when
  -- one ships; null otherwise (`derive_devices()` records the type anyway).
  module_code     text,
  brick_class     text,
  ifc_class       text,
  published_by    text not null default 'core',
  constraint device_types_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint device_types_not_own_parent check (parent_code is distinct from code)
);

comment on table device_types is
  'What a device can be: solar, wind, battery, charger, heat_pump, boiler, inverter, meter, sensor… A tree aligned on Brick Equipment and IFC. The instrument that measures is a device; what it measures is a series.';

-- A vocabulary with a tree (device_types, project_kinds, segments) names
-- the row it refines in `parent_code`; one function walks every tree.
create or replace function is_a(p_vocabulary text, p_code text, p_ancestor text)
returns boolean
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  found boolean;
begin
  if p_vocabulary not in ('device_types', 'project_kinds', 'segments') then
    raise exception 'vocabulary_unknown: % has no tree', p_vocabulary using errcode = 'invalid_parameter_value';
  end if;
  execute format($q$
    with recursive up as (
      select code, parent_code from %1$I where code = $1
      union all
      select t.code, t.parent_code from %1$I t join up on t.code = up.parent_code
    )
    select exists (select 1 from up where code = $2)$q$, p_vocabulary)
    into found using p_code, p_ancestor;
  return found;
end;
$$;

comment on function is_a(text, text, text) is
  'True when the code of a vocabulary with a tree (device_types, project_kinds, segments) is the ancestor or one of its refinements. Refuses vocabulary_unknown.';

create or replace function device_type_is_a(p_type text, p_ancestor text)
returns boolean
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select is_a('device_types', p_type, p_ancestor);
$$;

comment on function device_type_is_a(text, text) is
  'True when the type is the ancestor or one of its refinements (is_a() on device_types).';

-- ---------------------------------------------------------------------------
-- quantities — what can be measured, and the one unit it is stored in.
-- ---------------------------------------------------------------------------

create table quantities (
  code            text primary key,
  name            text not null,
  -- Every stored value of this quantity is in this unit, so no value carries
  -- a unit of its own and no sum mixes kWh and MWh. QUDT unit code.
  unit            text not null,
  -- How values combine over time: `sum` for energies and volumes (a value
  -- covers its interval), `mean` for powers and temperatures, `last` for
  -- states and counters.
  aggregation     text not null,
  qudt_quantity_kind text,
  description     text,
  published_by    text not null default 'core',
  constraint quantities_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint quantities_aggregation check (aggregation in ('sum', 'mean', 'last'))
);

comment on table quantities is
  'Physical quantities with the single unit their values are stored in (QUDT).';

-- ---------------------------------------------------------------------------
-- attribute_types — values that can be attached to an object as attributes.
-- ---------------------------------------------------------------------------

create table attribute_types (
  code            text primary key,
  name            text not null,
  description     text,
  datatype        text not null,
  -- For a number: the quantity, hence the unit, it is expressed in.
  quantity_code   text references quantities(code),
  minimum         numeric,
  maximum         numeric,
  -- For a text: the closed list of values it may take, if any.
  allowed_values  text[],
  -- Optional kinds of object the attribute type applies to: organisation,
  -- project, participant, meter, device, series.
  applies_to      text[],
  published_by    text not null default 'core',
  -- The capability that writes it besides data.write (`capabilities`):
  -- `account.contact` for a contact detail, `account.notifications` for a
  -- notification setting, which the account of a participant writes.
  written_with    text references capabilities(code),
  constraint attribute_types_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint attribute_types_datatype check (datatype in ('number', 'integer', 'text', 'boolean', 'date', 'json')),
  constraint attribute_types_quantity_only_numbers check (quantity_code is null or datatype in ('number', 'integer')),
  constraint attribute_types_applies_to check (applies_to <@ array['organisation', 'project', 'participant', 'meter', 'device', 'series'])
);

comment on table attribute_types is
  'Attributes a trade can attach to an object of the core: an annual consumption, an efficiency, a degradation rate, the parameters parameter_of() resolves… Aligned on bSDD and IFC property sets.';

-- ---------------------------------------------------------------------------
-- sources — the external systems data comes from.
-- ---------------------------------------------------------------------------

create table sources (
  code            text primary key,
  name            text not null,
  description     text,
  -- api: queried live; file: downloaded datasets; registry: an official
  -- register; device: read from equipment; manual: entered by a person;
  -- text: a published text a value is read from (a law, a
  -- statistic, an operator's page), cited the same way as an API.
  kind            text not null default 'api',
  base_url        text,
  docs_url        text,
  -- How a connector authenticates: none, api_key, oauth2, certificate,
  -- mandate (the data subject's authorisation, as with grid operators). A
  -- source is shared by every organisation and names no credential: an
  -- organisation's `connectors` row names its own, kept in the vault.
  auth            text not null default 'none',
  -- ISO 3166-1 alpha-2 codes the source covers; empty = worldwide.
  countries       text[] not null default '{}',
  -- ISO 3166-2 codes the source is limited to inside those countries;
  -- empty = the whole country. A regional register, a regional 3D model.
  regions         text[] not null default '{}',
  license         text,
  attribution     text,
  -- What the licence allows an installation to do with what it fetched:
  -- keep it this many days (null: for ever) and pass it on to others.
  -- A solar API's roof layers are a 30-day cache nobody may redistribute;
  -- an open register is both kept and shared.
  retention_days  integer,
  redistributable boolean not null default true,
  -- core, a module code, a pack, or the private connector package that
  -- brought the source along.
  published_by    text not null default 'core',
  constraint sources_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint sources_retention_positive check (retention_days is null or retention_days > 0),
  constraint sources_kind check (kind in ('api', 'file', 'registry', 'device', 'manual', 'text')),
  constraint sources_auth check (auth in ('none', 'api_key', 'oauth2', 'certificate', 'mandate'))
);

comment on table sources is
  'External systems data comes from: an open-data API, a grid operator''s hub, a solar API, a register, a device protocol. Identifiers, series, documents and attributes say which source they come from; connectors read here where to go.';

-- ---------------------------------------------------------------------------
-- identifier_schemes — external identifier systems.
-- ---------------------------------------------------------------------------

create table identifier_schemes (
  code            text primary key,
  name            text not null,
  description     text,
  -- Optional regular expression a value must match. A national register or
  -- a metering point numbering is published by its country pack.
  pattern         text,
  -- Where an identifier resolves: a URL template with {value}, and the
  -- source whose API answers for it.
  url_template    text,
  source_code     text references sources(code),
  -- The ISO 6523 International Code Designator of the scheme, four digits,
  -- when ISO 6523 lists it: the code under which an electronic invoice
  -- (EN 16931, Peppol) carries an identifier of this scheme, and the one
  -- the country packs of Ekwo OS name a party's scheme by. Null for the
  -- schemes that name a place or a thing, not a legal person.
  icd             text,
  published_by    text not null default 'core',
  constraint identifier_schemes_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint identifier_schemes_icd_format check (icd is null or icd ~ '^[0-9]{4}$')
);

comment on table identifier_schemes is
  'Identifier systems an object may also be known by: IFC GlobalId, OpenStreetMap, Overture GERS, a cadastre, a municipality code, a metering point numbering, a register of companies (with its ISO 6523 code).';

-- One scheme per ISO 6523 code: the code is how a legal number is matched
-- with the invoicing side.
create unique index identifier_schemes_icd_key on identifier_schemes (icd) where icd is not null;

-- The one check of an identifier against its scheme, for every table that
-- holds one (external identifiers, a module's metering points).
create or replace function identifier_valid(p_scheme text, p_value text)
returns boolean
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce((select p_value ~ s.pattern from identifier_schemes s where s.code = p_scheme), true);
$$;

comment on function identifier_valid(text, text) is
  'True when the value matches the pattern of its scheme, or the scheme has none.';

-- ---------------------------------------------------------------------------
-- currencies — the ISO 4217 currencies a price may count in.
-- ---------------------------------------------------------------------------

-- The same table, columns and constraints as Ekwo OS's `currencies`, so that
-- a database holding both cores keeps one list (docs/with-ekwo-os.md). `XXX`,
-- ISO 4217's "no currency", is the pattern the units of a price are written
-- in once (units, currency_units()).
create table currencies (
  code           char(3) primary key,
  name           text not null,
  symbol         text,
  decimal_places smallint not null default 2,
  active         boolean not null default true,
  constraint currencies_code_format check (code ~ '^[A-Z]{3}$'),
  constraint currencies_decimals check (decimal_places between 0 and 6)
);

comment on table currencies is
  'ISO 4217 currencies known to this installation: code, name, symbol, the decimals of its minor unit, whether it is in use; XXX is the pattern of the units of a price. Seeded by the core from the list Ekwo OS seeds, added to by packs.';

-- ---------------------------------------------------------------------------
-- sizing_criteria — what a sizing aims at, shared by every module that sizes.
-- ---------------------------------------------------------------------------

-- To size is one gesture, `<module>.size(subject, criterion, bounds)`
-- (decision 0045): the power of a PV system, the capacity of a battery. The
-- criterion it optimises is named from this vocabulary, never implied.
create table sizing_criteria (
  code          text primary key,
  name          text not null,
  -- maximise, minimise, or reach a target the caller gives.
  aim           text not null,
  description   text,
  published_by  text not null default 'core',
  constraint sizing_criteria_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint sizing_criteria_aim check (aim in ('maximise', 'minimise', 'target'))
);

comment on table sizing_criteria is
  'The criteria a sizing optimises, shared by every module that sizes (solar.size(), battery.size()): self-consumption rate, self-sufficiency, payback, net present value, maximum power. Vocabulary: written by the core seed, modules and packs.';

-- ---------------------------------------------------------------------------
-- value_statuses — what kind of value a value is.
-- ---------------------------------------------------------------------------

-- One vocabulary for the status of a value wherever a value is kept outside
-- a series: an attribute, a default of a pack. A series value says the same
-- with its two-byte quality code (series_values.quality); the words that
-- mean the same carry that code here, so a reader translates one into the
-- other without a table of its own: measured is quality 0, estimated is
-- quality 1. `published` (read in a text that decides it: a law, a tariff,
-- a datasheet, a register) and `default` (a conventional value a study
-- starts from when nothing better is known) have no series code; a series'
-- substituted (2) and missing (3) have no attribute.
create table value_statuses (
  code            text primary key,
  name            text not null,
  -- The code of series_values.quality meaning the same, when there is one.
  series_quality  smallint unique,
  description     text,
  published_by    text not null default 'core',
  constraint value_statuses_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint value_statuses_series_quality check (series_quality is null or series_quality in (0, 1, 2, 3))
);

comment on table value_statuses is
  'The status of a value kept as an attribute or a default: published, measured, estimated, default. measured and estimated carry the series quality code that means the same (0 and 1); parameter_of() returns the status with the value, so a costing says which line is published and which is estimated.';

insert into value_statuses (code, name, series_quality, description) values
  ('published', 'Published', null, 'Read in a text that decides it: a law, a regulated tariff, a register, a datasheet.'),
  ('measured',  'Measured',  0,    'Measured on the object itself: a reading, a survey, a test. Series quality 0.'),
  ('estimated', 'Estimated', 1,    'Computed or estimated from other values: a model, a statistic applied to the object, a person''s estimate. Series quality 1.'),
  ('default',   'Default',   null, 'A conventional value a study starts from when nothing better is known: a typical figure of a guide, an assumption.');

-- ---------------------------------------------------------------------------
-- project_kinds — what a project is.
-- ---------------------------------------------------------------------------

create table project_kinds (
  code            text primary key,
  name            text not null,
  description     text,
  -- The generic kind this one refines: a country's collective
  -- self-consumption frame is a collective self-consumption.
  parent_code     text references project_kinds(code),
  -- ISO 3166-1 alpha-2 of the country whose law defines it, for a legal
  -- frame a pack publishes; null for a generic kind the core publishes.
  country         char(2),
  -- The text that defines it, for a legal frame: a source of the
  -- vocabulary and the article.
  source_code     text references sources(code),
  reference       text,
  published_by    text not null default 'core',
  constraint project_kinds_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint project_kinds_not_own_parent check (parent_code is distinct from code),
  constraint project_kinds_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint project_kinds_frame_cited check (country is null or (source_code is not null and reference is not null))
);

comment on table project_kinds is
  'What a project is: a study, a rooftop PV project, an energy community, a collective or individual self-consumption, a district plan… The generic kinds are the core''s; the legal frames of a country (a collective self-consumption operation, a renewable energy community as its law defines them) are its pack''s, each refining a generic kind and citing its text. projects.kind names one; parameter_of() reads it as a condition of a default.';

-- ---------------------------------------------------------------------------
-- segments — the customer segment of a participant.
-- ---------------------------------------------------------------------------

create table segments (
  code            text primary key,
  name            text not null,
  description     text,
  -- The broader segment this one refines: a household is residential, a
  -- company professional. What a tariff or a tax distinguishes is often
  -- the broader one.
  parent_code     text references segments(code),
  published_by    text not null default 'core',
  constraint segments_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint segments_not_own_parent check (parent_code is distinct from code)
);

comment on table segments is
  'The customer segment of a participant: residential or professional, refined into a household, a co-ownership, a business, a public body, an association. participants.segment names one; parameter_of() reads it as a condition of a default (an excise rate, a reference price).';

-- ---------------------------------------------------------------------------
-- Access: readable by everyone signed in, written by migrations and seeds.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['device_types', 'quantities', 'attribute_types', 'sources', 'identifier_schemes', 'currencies', 'sizing_criteria', 'value_statuses', 'project_kinds', 'segments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end
$$;

grant execute on function is_a(text, text, text), device_type_is_a(text, text), identifier_valid(text, text) to authenticated, service_role;
