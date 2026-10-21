-- Nexgen OS — core: scenarios, what every kind of object shares, and the
-- one standard shape of a place.
--
-- The core names its objects: an organisation, a project, a participant, a
-- meter, a device, a series. Each is a table with the columns it always
-- has, and its hierarchy is its foreign keys: a participant belongs to a
-- project, a meter and a device to a participant. An attachment (an
-- attribute, an identifier, a link, a document, a series, a run) names its
-- object by its kind and its id; `kinds` says which table holds a kind, and
-- `object_organisation()` reads an object's organisation there. There is
-- no registry (decision 0044).
--
-- The place of the core is the participant's: an address, a point, a time
-- zone, geolocated but not described (decision 0045). What a place
-- physically is — its ground, its buildings, their floors, rooms and units,
-- their roof faces and facades — is the description of a building, the
-- `building` module's (decision 0008), which publishes its own kinds of
-- object in `kinds` and answers `participant_of()` for them.
--
-- Geometry is stored in WGS 84 (EPSG:4326), always three-dimensional, Z in
-- metres above sea level. Any CRS is accepted on the way in. Metric
-- computations project on the fly to the UTM zone of the geometry
-- (`metric_srid`), which works anywhere on earth without a national grid.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- scenarios — the reality, and the variants people design against it.
-- ---------------------------------------------------------------------------

create table scenarios (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A scenario may build on another one (variant B of the extension).
  parent_id        uuid references scenarios(id) on delete restrict,
  name             text not null,
  description      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scenarios_name_not_blank check (btrim(name) <> '')
);

comment on table scenarios is
  'A design variant. Rows with scenario_id null describe what exists; rows with a scenario_id exist only in that variant (a new building, a PV system, a heat pump, a simulated series).';

create index scenarios_organisation_idx on scenarios (organisation_id);

create trigger scenarios_set_updated_at
  before update on scenarios
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- What every kind of object shares.
-- ---------------------------------------------------------------------------

-- The organisation of an object named by its kind and its id, read in the
-- table `kinds` gives for the kind: one dynamic query. An organisation is
-- its own. Under row level security an object of an organisation the caller
-- does not read is not found.
create or replace function object_organisation(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t    text;
  org  uuid;
begin
  select k.table_name into t from kinds k where k.kind = p_kind;
  if t is null then
    raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end if;
  execute format('select %I from %s where id = $1', case when p_kind = 'organisation' then 'id' else 'organisation_id' end, t)
    into org using p_id;
  if org is null then
    raise exception 'object_not_found: % %', p_kind, p_id using errcode = 'no_data_found';
  end if;
  return org;
end;
$$;

comment on function object_organisation(text, uuid) is
  'The organisation of an object named by its kind and its id, read in the table of its kind. Refuses kind_unknown, object_not_found.';

-- The scenario an object exists only in; null for what exists (and for an
-- organisation, which belongs to none).
create or replace function object_scenario(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t    text;
  scn  uuid;
begin
  if p_kind = 'organisation' then
    return null;
  end if;
  select k.table_name into t from kinds k where k.kind = p_kind;
  if t is null then
    raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end if;
  execute format('select scenario_id from %s where id = $1', t) into scn using p_id;
  return scn;
end;
$$;

comment on function object_scenario(text, uuid) is
  'The scenario an object named by its kind and its id exists only in; null when it exists in reality. Refuses kind_unknown.';

-- BEFORE INSERT / UPDATE: the parent named by the foreign key tg_argv[0],
-- a row of the table tg_argv[1], is in the same organisation, and a parent
-- that exists only in a scenario only holds children of that scenario.
create or replace function parent_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col  text := tg_argv[0];
  pid  uuid;
  org  uuid;
  scn  uuid;
begin
  execute format('select ($1).%I', col) into pid using new;
  if pid is null then
    return new;
  end if;
  execute format('select organisation_id, scenario_id from %s where id = $1', tg_argv[1]) into org, scn using pid;
  if org is null then
    raise exception 'parent_not_found: %', pid using errcode = 'foreign_key_violation';
  end if;
  if org <> new.organisation_id then
    raise exception 'parent_in_other_organisation: %', col using errcode = 'check_violation';
  end if;
  if scn is not null and scn is distinct from new.scenario_id then
    raise exception 'parent_in_other_scenario: %', col using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function parent_check() is
  'Trigger of a foreign key to a parent (its column, then the parent''s table): the parent is in the same organisation, and in the same scenario when it exists only in one.';

-- AFTER DELETE on the table of a kind, tg_argv[0] being the kind: what was
-- attached to the row goes with it. An attachment is a table whose
-- `object_kind` (or `subject_kind`) references `kinds`, beside its
-- `object_id` (or `subject_id`): the core's, and those of a module that
-- attach to an object of any kind.
create or replace function drop_attachments()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  t record;
begin
  for t in
    select format('%I.%I', n.nspname, c.relname) as table_name, left(a.attname, -5) as side
      from pg_constraint f
      join pg_class c on c.oid = f.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = f.conrelid and a.attnum = f.conkey[1]
     where f.contype = 'f' and f.confrelid = 'nexgen.kinds'::regclass and cardinality(f.conkey) = 1
       and a.attname in ('object_kind', 'subject_kind') and not c.relispartition
  loop
    execute format('delete from %s where %I = $1 and %I = $2', t.table_name, t.side || '_kind', t.side || '_id')
      using tg_argv[0], old.id;
  end loop;
  return old;
end;
$$;

comment on function drop_attachments() is
  'AFTER DELETE on the table of a kind: deletes what was attached to the row, in every table whose object_kind (or subject_kind) references kinds.';

-- ---------------------------------------------------------------------------
-- Geometry helpers
-- ---------------------------------------------------------------------------

create or replace function metric_srid(p_geom geometry)
returns integer
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  -- UTM zone of the centroid: 326xx north, 327xx south.
  select case
           when p_geom is null then null
           else (case when ST_Y(ST_Centroid(p_geom)) >= 0 then 32600 else 32700 end)
                + least(60, greatest(1, floor((ST_X(ST_Centroid(p_geom)) + 180) / 6)::int + 1))
         end;
$$;

comment on function metric_srid(geometry) is
  'EPSG code of the UTM zone a WGS 84 geometry falls in, for areas, lengths and distances in metres anywhere.';

create or replace function area_m2(p_geom geometry)
returns numeric
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select round(ST_Area(ST_Transform(ST_Force2D(p_geom), metric_srid(p_geom)))::numeric, 2);
$$;

comment on function area_m2(geometry) is
  'Horizontal (plan) area in square metres of a WGS 84 polygon.';

create or replace function to_core_geometry(p_geom geometry)
returns geometry
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  g geometry := p_geom;
begin
  if g is null then
    return null;
  end if;
  if ST_SRID(g) = 0 then
    g := ST_SetSRID(g, 4326);
  elsif ST_SRID(g) <> 4326 then
    g := ST_Transform(g, 4326);
  end if;
  -- Polyhedral surfaces and TINs are 3D solids and surfaces whose validity
  -- needs SFCGAL. The others are checked in the plane they lie in: a flat
  -- polygon on its plan projection, a vertical one — a facade, a gable —
  -- on a side projection, where its plan projection would be a line. A
  -- planar polygon that is valid in its own plane is valid in at least one
  -- of the three; an invalid one is invalid in all three.
  if GeometryType(g) not in ('POLYHEDRALSURFACE', 'TIN', 'TRIANGLE')
     and not (ST_IsValid(ST_Force2D(g))
              or ST_IsValid(ST_Force2D(ST_RotateX(g, pi() / 2)))
              or ST_IsValid(ST_Force2D(ST_RotateY(g, pi() / 2)))) then
    raise exception 'invalid_geometry: %', ST_IsValidReason(ST_Force2D(g))
      using errcode = 'check_violation';
  end if;
  return ST_Force3D(g);
end;
$$;

comment on function to_core_geometry(geometry) is
  'Any geometry, in any CRS, comes out valid, in EPSG:4326 and three-dimensional. Every geometry column of the core goes through it.';

-- BEFORE INSERT / UPDATE: normalises the geometry column named by tg_argv[0].
create or replace function normalize_geometry()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col text := tg_argv[0];
  g   geometry;
begin
  execute format('select ($1).%I', col) into g using new;
  g := to_core_geometry(g);
  -- geometry::text is hex EWKB, which the geometry input reads back as is.
  new := jsonb_populate_record(new, jsonb_build_object(col, g::text));
  return new;
end;
$$;

comment on function normalize_geometry() is
  'Trigger of every geometry column: the value goes through to_core_geometry().';

-- ---------------------------------------------------------------------------
-- The one standard shape of a place.
--
-- Every geocoder, every importer and the command line produce it; a
-- participant stores it; `place_of()` gives it back. Its keys are the
-- place columns of `participants`, plus the identifiers the place is known by (a municipality code
-- under its pack's scheme, a geocoder's own id):
--
--   { "street": "…", "address_extra": null, "postal_code": "…",
--     "city": "…", "region": "<ISO 3166-2>", "country": "<ISO 3166-1>",
--     "geometry": { "type": "Point", "coordinates": [lon, lat, z] },
--     "location_precision": "rooftop", "location_source_code": "<source>",
--     "identifiers": [ { "scheme": "<id_schemes.code>", "value": "…" } ] }
--
-- GeoJSON is the geometry's one interchange form; it is stored in WGS 84 3D.
-- ---------------------------------------------------------------------------

create or replace function place_check(p_place jsonb)
returns jsonb
language plpgsql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k text;
begin
  if p_place is null or jsonb_typeof(p_place) <> 'object' then
    raise exception 'place_invalid: a place is a JSON object' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(p_place) loop
    if k not in ('street', 'address_extra', 'postal_code', 'city', 'region', 'country', 'geometry',
                 'location_precision', 'location_source_code', 'identifiers') then
      raise exception 'place_key_unknown: %', k using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if p_place ? 'identifiers' and jsonb_typeof(p_place->'identifiers') <> 'array' then
    raise exception 'place_invalid: identifiers is an array of {scheme, value}' using errcode = 'invalid_parameter_value';
  end if;
  return p_place;
end;
$$;

comment on function place_check(jsonb) is
  'Returns the place when it is the standard shape (the keys of place_of()), else refuses by name: place_invalid, place_key_unknown.';

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function create_scenario(p_organisation_id uuid, p_name text, p_parent_id uuid default null, p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_parent_id is not null and not exists (select 1 from scenarios where id = p_parent_id and organisation_id = p_organisation_id) then
    raise exception 'scenario_not_found: %', p_parent_id using errcode = 'no_data_found';
  end if;
  insert into scenarios (id, organisation_id, parent_id, name, description)
  values (v_id, p_organisation_id, p_parent_id, p_name, p_description);
  return v_id;
end;
$$;

comment on function create_scenario(uuid, text, uuid, text) is
  'Creates a design variant of an organisation, on top of another one when a parent is given. Returns its id.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

call secure_table('scenarios');

grant execute on function object_organisation(text, uuid), object_scenario(text, uuid),
  metric_srid(geometry), area_m2(geometry), to_core_geometry(geometry),
  place_check(jsonb),
  create_scenario(uuid, text, uuid, text)
  to authenticated, service_role;
