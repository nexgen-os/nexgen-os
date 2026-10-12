-- Nexgen OS — core: vocabularies.
--
-- The objects of the core are named tables: a site, a building, a device.
-- What varies inside them is held as data, never as an enum: which kinds of
-- devices exist, what a building is used for, how two objects may be linked,
-- which values can be attached and in which unit, which tags and which
-- identifier systems are known. A new kind of thing is a row a module or a
-- country pack publishes, with no migration of the core.
--
-- Every vocabulary row maps to the open standard it comes from:
--
--   device_types    Brick Schema equipment classes, IFC distribution elements
--   profiles        the use of a building or a site (Nexgen profiles)
--   link_types      Brick relationships, IFC objectified relationships
--   property_defs   buildingSMART Data Dictionary (bSDD), IFC property sets
--   quantities      QUDT quantity kinds and units
--   tags            Project Haystack marker tags
--   id_schemes      IFC GlobalId, OpenStreetMap, Overture GERS, national registers
--
-- Vocabularies are shared by every organisation of an installation, read by
-- everyone signed in and written only by migrations and seeds. Each row says
-- who published it: `core`, a module code or a pack code.

-- ---------------------------------------------------------------------------
-- device_types — what a device can be.
-- ---------------------------------------------------------------------------

create table device_types (
  code            text primary key,
  name            text not null,
  description     text,
  -- The more general type this one refines: an electricity meter is a meter.
  parent_code     text references device_types(code),
  -- The module that derives devices of this type into its own table, if any.
  module_code     text,
  brick_class     text,
  ifc_class       text,
  published_by    text not null default 'core',
  constraint device_types_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint device_types_not_own_parent check (parent_code is distinct from code)
);

comment on table device_types is
  'What a device can be: solar, wind, battery, ev, heatpump, boiler, inverter, meter, sensor… A tree aligned on Brick and IFC. A module derives the types it owns.';

create or replace function device_type_is_a(p_type text, p_ancestor text)
returns boolean
language sql
stable
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
-- profiles — what a building or a site is used for.
-- ---------------------------------------------------------------------------

create table profiles (
  code            text primary key,
  name            text not null,
  description     text,
  -- building: a use of a building (office, school, dwelling); site: a use of
  -- a site without a building to speak of (a field, a car park, a plant).
  nature          text not null default 'building',
  ifc_occupancy   text,
  citygml_function text,
  published_by    text not null default 'core',
  constraint profiles_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint profiles_nature check (nature in ('building', 'site'))
);

comment on table profiles is
  'The use of a building or a site: residential, office, school, factory, farm, car park… Modules add their own (a load profile is an energy profile of a use).';

-- ---------------------------------------------------------------------------
-- link_types — how two objects may be linked (besides their own columns).
-- ---------------------------------------------------------------------------

create table link_types (
  code            text primary key,
  name            text not null,
  -- Name read from the object's side: `feeds` / `is fed by`.
  inverse_name    text not null,
  description     text,
  -- Optional kinds the subject and the object must be (see objects.kind).
  subject_kinds   text[],
  object_kinds    text[],
  brick_relation  text,
  ifc_relation    text,
  published_by    text not null default 'core',
  constraint link_types_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table link_types is
  'Typed links between two objects that are not a column of either: feeds, serves, shades, owns, occupies, operates…';

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
  -- Optional kinds of object the property applies to (see objects.kind).
  applies_to      text[],
  -- Correspondences: IFC property set and property name, bSDD URI.
  ifc_pset        text,
  ifc_property    text,
  bsdd_uri        text,
  published_by    text not null default 'core',
  constraint property_defs_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint property_defs_datatype check (datatype in ('number', 'integer', 'text', 'boolean', 'date', 'json')),
  constraint property_defs_quantity_only_numbers check (quantity_code is null or datatype in ('number', 'integer'))
);

comment on table property_defs is
  'Attributes a trade can attach to an object: gross floor area, year of construction, U-value, energy label, efficiency… Aligned on bSDD and IFC property sets.';

-- ---------------------------------------------------------------------------
-- tags — marker tags an object may carry.
-- ---------------------------------------------------------------------------

create table tags (
  code            text primary key,
  name            text not null,
  description     text,
  haystack_tag    text,
  published_by    text not null default 'core',
  constraint tags_code_format check (code ~ '^[a-z][a-zA-Z0-9_]*$')
);

comment on table tags is
  'Marker tags (Project Haystack): heritage, critical, public, green roof… Free to add, checked on use.';

create or replace function tags_known(p_tags text[])
returns boolean
language sql
stable
as $$
  select not exists (select 1 from unnest(p_tags) t where not exists (select 1 from tags where code = t));
$$;

-- ---------------------------------------------------------------------------
-- sources — the external systems data comes from.
-- ---------------------------------------------------------------------------

create table sources (
  code            text primary key,
  name            text not null,
  description     text,
  -- api: queried live; file: downloaded datasets; registry: an official
  -- register; device: read from equipment; manual: entered by a person.
  kind            text not null default 'api',
  base_url        text,
  docs_url        text,
  -- How a connector authenticates: none, api_key, oauth2, certificate,
  -- mandate (the data subject's authorisation, as with grid operators). The
  -- secret itself never lives in the core; `secret_ref` names it in the
  -- installation's vault.
  auth            text not null default 'none',
  secret_ref      text,
  -- ISO 3166-1 alpha-2 codes the source covers; empty = worldwide.
  countries       text[] not null default '{}',
  license         text,
  attribution     text,
  published_by    text not null default 'core',
  constraint sources_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint sources_kind check (kind in ('api', 'file', 'registry', 'device', 'manual')),
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
  'Identifier systems an object may also be known by: IFC GlobalId, OpenStreetMap, Overture GERS, a cadastre, a metering point numbering.';

-- ---------------------------------------------------------------------------
-- Access: readable by everyone signed in, written by migrations and seeds.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['device_types', 'profiles', 'link_types', 'quantities', 'property_defs', 'tags', 'sources', 'id_schemes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end
$$;

grant execute on function device_type_is_a(text, text), tags_known(text[]) to authenticated, service_role;
