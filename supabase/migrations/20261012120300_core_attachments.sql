-- Nexgen OS — core: what is attached to an entity.
--
--   entity_values      a value of a defined property, valid over a period
--                      (IFC property sets, bSDD properties, NGSI-LD Property)
--   relationships      a typed link to another entity
--                      (Brick relationships, IFC objectified relationships)
--   representations    a shape or a file showing the entity: LoD blocks,
--                      roof models, meshes, BIM models, point clouds,
--                      orthophotos, images, videos, 3D tiles (CityGML LoD)
--   external_ids       the identifiers it is known by elsewhere
--
-- Each attachment carries the workspace of its entity, copied by trigger so
-- that row level security reads one column, and may belong to a scenario.

-- Copies the workspace of the entity named by the given column, and refuses
-- an attachment to an entity of another scenario than its own.
create or replace function attach_to_entity()
returns trigger
language plpgsql
as $$
declare
  col  text := coalesce(tg_argv[0], 'entity_id');
  eid  uuid;
  e    entities%rowtype;
begin
  execute format('select ($1).%I', col) into eid using new;
  select * into e from entities where id = eid;
  if not found then
    raise exception 'entity_not_found: %', eid using errcode = 'foreign_key_violation';
  end if;
  if e.scenario_id is not null and e.scenario_id is distinct from new.scenario_id then
    raise exception 'attachment_outside_entity_scenario' using errcode = 'check_violation';
  end if;
  new.workspace_id := e.workspace_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- entity_values
-- ---------------------------------------------------------------------------

create table entity_values (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  entity_id     uuid not null references entities(id) on delete cascade,
  property_code text not null references property_defs(code),
  -- A JSON scalar (or a JSON document for datatype `json`). Numbers are in
  -- the unit of the property's quantity, always.
  value         jsonb not null,
  -- Period over which the value holds. Null bounds are open: a value with
  -- no dates holds always. History is kept by closing a period and opening
  -- the next, never by overwriting.
  valid_from    timestamptz,
  valid_to      timestamptz,
  scenario_id   uuid references scenarios(id) on delete cascade,
  -- Where the value comes from: a survey, a BIM import, a datasheet, a
  -- computation run, a person. Free text, for provenance.
  source        text,
  created_at    timestamptz not null default now(),
  constraint entity_values_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table entity_values is
  'Values attached to entities — floor area, year built, peak power, U-value, label — typed by property_defs, with validity periods and provenance.';

create unique index entity_values_one_per_period on entity_values
  (entity_id, property_code, scenario_id, valid_from) nulls not distinct;
create index entity_values_entity_idx on entity_values (entity_id);
create index entity_values_property_idx on entity_values (property_code);

create trigger entity_values_attach
  before insert or update on entity_values
  for each row execute function attach_to_entity('entity_id');

create or replace function entity_values_check()
returns trigger
language plpgsql
as $$
declare
  def   property_defs%rowtype;
  cls   text;
  t     text := jsonb_typeof(new.value);
  n     numeric;
begin
  select * into def from property_defs where code = new.property_code;
  select class into cls from entities where id = new.entity_id;

  if def.applies_to is not null and not class_is_a(cls, def.applies_to) then
    raise exception 'property_not_applicable: % does not apply to a %', def.code, cls
      using errcode = 'check_violation';
  end if;

  if def.datatype in ('number', 'integer') then
    if t <> 'number' then
      raise exception 'invalid_value: % must be a number', def.code using errcode = 'check_violation';
    end if;
    n := (new.value #>> '{}')::numeric;
    if def.datatype = 'integer' and n <> trunc(n) then
      raise exception 'invalid_value: % must be an integer', def.code using errcode = 'check_violation';
    end if;
    if def.minimum is not null and n < def.minimum then
      raise exception 'invalid_value: % must be at least %', def.code, def.minimum using errcode = 'check_violation';
    end if;
    if def.maximum is not null and n > def.maximum then
      raise exception 'invalid_value: % must be at most %', def.code, def.maximum using errcode = 'check_violation';
    end if;
  elsif def.datatype in ('text', 'date') then
    if t <> 'string' then
      raise exception 'invalid_value: % must be a string', def.code using errcode = 'check_violation';
    end if;
    if def.datatype = 'date' then
      perform (new.value #>> '{}')::date;
    end if;
    if def.allowed_values is not null and not (new.value #>> '{}') = any (def.allowed_values) then
      raise exception 'invalid_value: % must be one of %', def.code, def.allowed_values using errcode = 'check_violation';
    end if;
  elsif def.datatype = 'boolean' and t <> 'boolean' then
    raise exception 'invalid_value: % must be a boolean', def.code using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from entity_values v
     where v.entity_id = new.entity_id
       and v.property_code = new.property_code
       and v.scenario_id is not distinct from new.scenario_id
       and v.id <> new.id
       and tstzrange(v.valid_from, v.valid_to) && tstzrange(new.valid_from, new.valid_to)
  ) then
    raise exception 'overlapping_value: % already has a value over that period', def.code
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

create trigger entity_values_check
  before insert or update on entity_values
  for each row execute function entity_values_check();

-- The values of an entity at a moment, in a scenario, as one JSON object. A
-- scenario sees reality, overridden by what the scenario (and the scenarios
-- it builds on) changed.
create or replace function entity_properties(
  p_entity_id   uuid,
  p_at          timestamptz default now(),
  p_scenario_id uuid default null
)
returns jsonb
language sql
stable
as $$
  with recursive chain as (
    select s.id, s.parent_id, 1 as rank from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id, chain.rank + 1 from scenarios s join chain on s.id = chain.parent_id
  ),
  candidates as (
    select v.property_code, v.value,
           coalesce((select rank from chain where chain.id = v.scenario_id), case when v.scenario_id is null then 1000000 end) as rank
      from entity_values v
     where v.entity_id = p_entity_id
       and (v.valid_from is null or v.valid_from <= p_at)
       and (v.valid_to is null or v.valid_to > p_at)
  ),
  best as (
    select distinct on (property_code) property_code, value
      from candidates
     where rank is not null
     order by property_code, rank
  )
  select coalesce(jsonb_object_agg(property_code, value), '{}'::jsonb) from best;
$$;

comment on function entity_properties(uuid, timestamptz, uuid) is
  'Every value of an entity holding at a moment, in a scenario (null = reality), as one JSON object. The one place values are read from.';

-- ---------------------------------------------------------------------------
-- relationships
-- ---------------------------------------------------------------------------

create table relationships (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  subject_id    uuid not null references entities(id) on delete cascade,
  type_code     text not null references relation_types(code),
  object_id     uuid not null references entities(id) on delete cascade,
  valid_from    timestamptz,
  valid_to      timestamptz,
  scenario_id   uuid references scenarios(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint relationships_not_reflexive check (subject_id <> object_id),
  constraint relationships_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table relationships is
  'Typed links between two entities: the inverter feeds the building, the sensor monitors the room, the array is mounted on the roof, the company occupies the storey.';

create unique index relationships_unique on relationships
  (subject_id, type_code, object_id, scenario_id, valid_from) nulls not distinct;
create index relationships_object_idx on relationships (object_id);

create trigger relationships_attach
  before insert or update on relationships
  for each row execute function attach_to_entity('subject_id');

create or replace function relationships_check()
returns trigger
language plpgsql
as $$
declare
  rt   relation_types%rowtype;
  s    entities%rowtype;
  o    entities%rowtype;
begin
  select * into rt from relation_types where code = new.type_code;
  select * into s from entities where id = new.subject_id;
  select * into o from entities where id = new.object_id;
  if o.workspace_id <> s.workspace_id then
    raise exception 'relationship_across_workspaces' using errcode = 'check_violation';
  end if;
  if o.scenario_id is not null and o.scenario_id is distinct from new.scenario_id then
    raise exception 'attachment_outside_entity_scenario' using errcode = 'check_violation';
  end if;
  if rt.subject_class is not null and not class_is_a(s.class, rt.subject_class) then
    raise exception 'relationship_subject_class: % needs a % as subject, got a %', rt.code, rt.subject_class, s.class
      using errcode = 'check_violation';
  end if;
  if rt.object_class is not null and not class_is_a(o.class, rt.object_class) then
    raise exception 'relationship_object_class: % needs a % as object, got a %', rt.code, rt.object_class, o.class
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger relationships_check
  before insert or update on relationships
  for each row execute function relationships_check();

-- ---------------------------------------------------------------------------
-- representations
-- ---------------------------------------------------------------------------

create table representations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  entity_id     uuid not null references entities(id) on delete cascade,
  -- outline: a 2D or 3D outline (footprint, slab)
  -- solid: a closed volume (an extruded block, a BIM solid)
  -- surfaces: a surface model (roof faces of a LoD2 building)
  -- mesh, bim_model, point_cloud, tiles: files (glTF, IFC, COPC/LAZ, 3D Tiles)
  -- orthophoto, image, video: captured or rendered media
  kind          text not null,
  -- Level of detail where it applies: CityGML 0 to 3, refined as TU Delft
  -- does (1.2 and 1.3 for blocks with roof heights, 2.2 for roofs with
  -- dormers and overhangs).
  lod           numeric(2, 1),
  -- Unconstrained type so that any CRS and any dimension is accepted on the
  -- way in; the trigger normalises and the check below guarantees the result.
  geometry      geometry,
  -- A file somewhere: object storage, a public URL. With its media type.
  uri           text,
  media_type    text,
  -- Who or what produced it: survey, drone flight, BIM import, OpenStreetMap,
  -- a solar API, a module's render. Provenance, free text.
  source        text,
  captured_at   timestamptz,
  -- Format-specific details: camera path of a video, point density of a
  -- cloud, IFC schema version, georeferencing of a local model.
  metadata      jsonb not null default '{}',
  scenario_id   uuid references scenarios(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint representations_kind check (kind in (
    'outline', 'solid', 'surfaces', 'mesh', 'bim_model', 'point_cloud', 'tiles',
    'orthophoto', 'image', 'video'
  )),
  constraint representations_lod check (lod is null or lod in (0, 1, 1.2, 1.3, 2, 2.2, 3)),
  constraint representations_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint representations_has_content check (geometry is not null or uri is not null)
);

comment on table representations is
  'Shapes and files showing an entity: LoD blocks, roof models, meshes, BIM models, point clouds, orthophotos, images, videos, 3D tiles — several per entity, with provenance.';

create index representations_entity_idx on representations (entity_id);
create index representations_geometry_idx on representations using gist (geometry);

create or replace function representations_normalize()
returns trigger
language plpgsql
as $$
begin
  new.geometry := to_core_geometry(new.geometry);
  return new;
end;
$$;

create trigger representations_attach
  before insert or update on representations
  for each row execute function attach_to_entity('entity_id');
create trigger representations_normalize
  before insert or update of geometry on representations
  for each row execute function representations_normalize();

-- A level-of-detail 1 block, derived and never stored: the footprint of the
-- entity extruded from its elevation by its height, as a polyhedral surface.
create or replace function lod1_block(p_entity_id uuid)
returns geometry
language plpgsql
stable
as $$
declare
  e      entities%rowtype;
  ring   geometry;
  base   numeric;
  top    numeric;
  faces  text[] := '{}';
  pts    geometry[];
  i      int;
  a      geometry;
  b      geometry;
begin
  select * into e from entities where id = p_entity_id;
  if e.geometry is null or e.height_m is null or GeometryType(ST_Force2D(e.geometry)) not in ('POLYGON') then
    return null;
  end if;
  base := coalesce(e.elevation_m, 0);
  top := base + e.height_m;
  ring := ST_ExteriorRing(ST_ForceRHR(ST_Force2D(e.geometry)));
  select array_agg(d.geom order by d.path) into pts from ST_DumpPoints(ring) d;
  -- floor (reversed), roof, walls
  faces := faces || format('((%s))', (
    select string_agg(format('%s %s %s', ST_X(p), ST_Y(p), base), ',') from unnest(pts) p
  ));
  faces := faces || format('((%s))', (
    select string_agg(format('%s %s %s', ST_X(p), ST_Y(p), top), ',' order by ord desc)
      from unnest(pts) with ordinality as u(p, ord)
  ));
  for i in 1 .. array_length(pts, 1) - 1 loop
    a := pts[i];
    b := pts[i + 1];
    faces := faces || format('((%s %s %s,%s %s %s,%s %s %s,%s %s %s,%s %s %s))',
      ST_X(a), ST_Y(a), base, ST_X(a), ST_Y(a), top, ST_X(b), ST_Y(b), top,
      ST_X(b), ST_Y(b), base, ST_X(a), ST_Y(a), base);
  end loop;
  return ST_SetSRID(ST_GeomFromText('POLYHEDRALSURFACE Z (' || array_to_string(faces, ',') || ')'), 4326);
end;
$$;

comment on function lod1_block(uuid) is
  'Level-of-detail 1 block of an entity: its footprint extruded from its elevation by its height. Derived from the entity, never stored.';

-- ---------------------------------------------------------------------------
-- external_ids
-- ---------------------------------------------------------------------------

create table external_ids (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  entity_id     uuid not null references entities(id) on delete cascade,
  scheme        text not null references id_schemes(code),
  value         text not null,
  -- When the identifier named this entity: registers retire and reissue.
  valid_from    timestamptz,
  valid_to      timestamptz,
  scenario_id   uuid references scenarios(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, scheme, value),
  constraint external_ids_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table external_ids is
  'Identifiers an entity is known by elsewhere (IFC GlobalId, OSM, Overture GERS, a cadastre, a metering point). One value names one entity per workspace.';

create index external_ids_entity_idx on external_ids (entity_id);

create or replace function external_ids_check()
returns trigger
language plpgsql
as $$
declare
  pat text;
begin
  select pattern into pat from id_schemes where code = new.scheme;
  if pat is not null and new.value !~ pat then
    raise exception 'invalid_identifier: % is not a valid %', new.value, new.scheme
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger external_ids_attach
  before insert or update on external_ids
  for each row execute function attach_to_entity('entity_id');
create trigger external_ids_check
  before insert or update on external_ids
  for each row execute function external_ids_check();

-- ---------------------------------------------------------------------------
-- entity_lineage — what became of an entity that was split, merged or
-- replaced. Identifiers never encode anything and are never reused; when a
-- parcel is split or two buildings are merged, the old and new entities are
-- linked here so that history and external references stay traceable.
-- ---------------------------------------------------------------------------

create table entity_lineage (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  from_id       uuid not null references entities(id) on delete cascade,
  to_id         uuid not null references entities(id) on delete cascade,
  kind          text not null,
  at            timestamptz not null default now(),
  primary key (from_id, to_id),
  constraint entity_lineage_kind check (kind in ('split', 'merge', 'replace')),
  constraint entity_lineage_not_reflexive check (from_id <> to_id)
);

comment on table entity_lineage is
  'Splits, merges and replacements between entities, so that history and external references survive a change of identity.';

create or replace function entity_lineage_attach()
returns trigger
language plpgsql
as $$
declare
  a uuid;
  b uuid;
begin
  select workspace_id into a from entities where id = new.from_id;
  select workspace_id into b from entities where id = new.to_id;
  if a <> b then
    raise exception 'lineage_across_workspaces' using errcode = 'check_violation';
  end if;
  new.workspace_id := a;
  return new;
end;
$$;

create trigger entity_lineage_attach
  before insert or update on entity_lineage
  for each row execute function entity_lineage_attach();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['entity_values', 'relationships', 'representations', 'external_ids', 'entity_lineage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (can_read_workspace(workspace_id))', t || '_select', t);
    execute format('create policy %I on %I for all to authenticated using (can_write_workspace(workspace_id)) with check (can_write_workspace(workspace_id))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end
$$;

grant execute on function entity_properties(uuid, timestamptz, uuid), lod1_block(uuid)
  to authenticated, service_role;
