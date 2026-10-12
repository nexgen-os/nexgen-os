-- Nexgen OS — core: vocabularies.
--
-- The core knows one kind of row — an entity — and lets vocabularies say what
-- an entity can be, how two entities can relate, which values can be attached
-- to them and in which unit, and which tags they can carry. A vocabulary is
-- data, never an enum: a new kind of thing (a bridge, a green roof, a heat
-- pump family, a drone survey) is a row a module or a country pack publishes,
-- with no migration of the core.
--
-- Every vocabulary row maps to the open standard it comes from, so that a
-- model can be read in and written out without guessing:
--
--   classes          Brick Schema classes, IFC entities, CityGML classes
--   relation_types   Brick relationships, IFC objectified relationships
--   property_defs    buildingSMART Data Dictionary (bSDD) properties, IFC property sets
--   quantities       QUDT quantity kinds and units
--   tags             Project Haystack marker tags
--   id_schemes       IFC GlobalId, OpenStreetMap, Overture GERS, national registers
--
-- Vocabularies are shared by every workspace of an installation, read by
-- everyone signed in and written only by migrations and seeds. Each row says
-- who published it: `core`, a module code or a pack code.

-- ---------------------------------------------------------------------------
-- classes — what an entity can be.
-- ---------------------------------------------------------------------------

create table classes (
  code            text primary key,
  name            text not null,
  description     text,
  -- The more general class this one refines. Roots: location, element,
  -- equipment, point, agent, collection.
  parent_code     text references classes(code),
  -- Classes an entity of this class may be contained in (directly), checked
  -- by class ancestry: allowing `building` allows every subclass of it.
  -- Empty = no containment rule. The empty string allows the root.
  allowed_parents text[] not null default '{}',
  brick_class     text,
  ifc_class       text,
  citygml_class   text,
  published_by    text not null default 'core',
  constraint classes_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint classes_not_own_parent check (parent_code is distinct from code)
);

comment on table classes is
  'What an entity can be: a district, a building, a storey, a space, a roof, a wall, a PV array, a heat pump, a sensor, an organisation. A tree of classes aligned on Brick, IFC and CityGML.';

create or replace function class_is_a(p_class text, p_ancestor text)
returns boolean
language sql
stable
as $$
  with recursive up as (
    select code, parent_code from classes where code = p_class
    union all
    select c.code, c.parent_code from classes c join up on c.code = up.parent_code
  )
  select exists (select 1 from up where code = p_ancestor);
$$;

comment on function class_is_a(text, text) is
  'True when the class is the ancestor or one of its refinements.';

-- ---------------------------------------------------------------------------
-- relation_types — how two entities can relate (besides containment).
-- ---------------------------------------------------------------------------

create table relation_types (
  code            text primary key,
  name            text not null,
  -- Name read from the object's side: `feeds` / `is_fed_by`.
  inverse_name    text not null,
  description     text,
  -- Optional class roots the subject and the object must belong to.
  subject_class   text references classes(code),
  object_class    text references classes(code),
  brick_relation  text,
  ifc_relation    text,
  published_by    text not null default 'core',
  constraint relation_types_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table relation_types is
  'Typed links between entities: feeds, serves, monitors, mounted_on, shades, owns, occupies, member_of…';

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
-- property_defs — values that can be attached to an entity.
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
  -- Optional class root the property applies to.
  applies_to      text references classes(code),
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
  'Attachable values: gross floor area, year of construction, peak power, tilt, U-value, energy label… Aligned on bSDD and IFC property sets.';

-- ---------------------------------------------------------------------------
-- tags — marker tags an entity may carry.
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
  'Marker tags (Project Haystack): heritage, listed, rooftop, critical, public… Free to add, checked on use.';

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
  url_template    text,
  published_by    text not null default 'core',
  constraint id_schemes_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table id_schemes is
  'Identifier systems an entity may also be known by: IFC GlobalId, OpenStreetMap, Overture GERS, a cadastre, a metering point.';

-- ---------------------------------------------------------------------------
-- Access: readable by everyone signed in, written by migrations and seeds.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['classes', 'relation_types', 'quantities', 'property_defs', 'tags', 'id_schemes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
  end loop;
end
$$;

grant execute on function class_is_a(text, text) to authenticated, service_role;
