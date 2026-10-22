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
--   device_types    Brick Schema equipment classes, IFC distribution elements
--   property_defs   buildingSMART Data Dictionary (bSDD), IFC property sets
--   quantities      QUDT quantity kinds and units
--   sources         the external systems data comes from, with their licence
--   id_schemes      IFC GlobalId, OpenStreetMap, Overture GERS, national registers
--
-- Vocabularies are shared by every organisation of an installation, read by
-- everyone signed in and written only by migrations and seeds. Each row says
-- who published it: `core`, a module code or a pack code.

set search_path = nexgen, public, extensions;

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

create or replace function device_type_is_a(p_type text, p_ancestor text)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive up as (
    select code, parent_code from device_types where code = p_type
    union all
    select t.code, t.parent_code from device_types t join up on t.code = up.parent_code
  )
  select exists (select 1 from up where code = p_ancestor);
$$;

comment on function device_type_is_a(text, text) is
  'True when the type is the ancestor or one of its refinements.';

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
-- property_defs — values that can be attached to an object as attributes.
-- ---------------------------------------------------------------------------

create table property_defs (
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
  -- Optional kinds of object the property applies to: organisation,
  -- project, participant, meter, device, series.
  applies_to      text[],
  published_by    text not null default 'core',
  constraint property_defs_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint property_defs_datatype check (datatype in ('number', 'integer', 'text', 'boolean', 'date', 'json')),
  constraint property_defs_quantity_only_numbers check (quantity_code is null or datatype in ('number', 'integer')),
  constraint property_defs_applies_to check (applies_to <@ array['organisation', 'project', 'participant', 'meter', 'device', 'series'])
);

comment on table property_defs is
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
-- id_schemes — external identifier systems.
-- ---------------------------------------------------------------------------

create table id_schemes (
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
  published_by    text not null default 'core',
  constraint id_schemes_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table id_schemes is
  'Identifier systems an object may also be known by: IFC GlobalId, OpenStreetMap, Overture GERS, a cadastre, a municipality code, a metering point numbering.';

-- The one check of an identifier against its scheme, for every table that
-- holds one (external identifiers, a module's metering points).
create or replace function identifier_valid(p_scheme text, p_value text)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce((select p_value ~ s.pattern from id_schemes s where s.code = p_scheme), true);
$$;

comment on function identifier_valid(text, text) is
  'True when the value matches the pattern of its scheme, or the scheme has none.';

-- ---------------------------------------------------------------------------
-- Access: readable by everyone signed in, written by migrations and seeds.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['device_types', 'quantities', 'property_defs', 'sources', 'id_schemes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end
$$;

grant execute on function device_type_is_a(text, text), identifier_valid(text, text) to authenticated, service_role;
