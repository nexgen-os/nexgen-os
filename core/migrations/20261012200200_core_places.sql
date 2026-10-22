-- Nexgen OS — core: what every object shares, and the one standard shape of
-- a place.
--
-- The core names six objects: an organisation, a project, a participant, a
-- meter, a device, a series. Each is a table with the columns it always
-- has, and its hierarchy is its foreign keys: a participant belongs to a
-- project, a meter and a device to a participant. An attachment (an
-- attribute, an identifier, a document, a series) names its object by its
-- kind, one of those six words, and its id; `object_organisation()` reads
-- an object's organisation in the table of its kind. There is no registry
-- and no table of kinds (decision 0044).
--
-- The place of the core is the participant's: an address, a point, a time
-- zone, geolocated but not described (decision 0045). What a place
-- physically is — its ground, its buildings, their floors, rooms and units,
-- their roof faces and facades — is the description of a building, the
-- `building` module's (decision 0008).
--
-- Geometry is stored in WGS 84 (EPSG:4326), always three-dimensional, Z in
-- metres above sea level. Any CRS is accepted on the way in. Metric
-- computations project on the fly to the UTM zone of the geometry
-- (`metric_srid`), which works anywhere on earth without a national grid.

set search_path = nexgen, public, extensions;

-- ---------------------------------------------------------------------------
-- What every kind of object shares.
-- ---------------------------------------------------------------------------

-- The organisation of an object named by its kind and its id, read in the
-- table of its kind. An organisation is its own. Under row level security
-- an object of an organisation the caller does not read is not found.
create or replace function object_organisation(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  org  uuid;
begin
  case p_kind
    when 'organisation' then select id into org from organisations where id = p_id;
    when 'project' then select organisation_id into org from projects where id = p_id;
    when 'participant' then select organisation_id into org from participants where id = p_id;
    when 'meter' then select organisation_id into org from meters where id = p_id;
    when 'device' then select organisation_id into org from devices where id = p_id;
    when 'series' then select organisation_id into org from series where id = p_id;
    else
      raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end case;
  if org is null then
    raise exception 'object_not_found: % %', p_kind, p_id using errcode = 'no_data_found';
  end if;
  return org;
end;
$$;

comment on function object_organisation(text, uuid) is
  'The organisation of an object named by its kind (organisation, project, participant, meter, device, series) and its id, read in the table of its kind. Refuses kind_unknown, object_not_found.';

-- BEFORE INSERT / UPDATE: the parent named by the foreign key tg_argv[0],
-- a row of the table tg_argv[1], is in the same organisation.
create or replace function parent_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  col  text := tg_argv[0];
  pid  uuid;
  org  uuid;
begin
  execute format('select ($1).%I', col) into pid using new;
  if pid is null then
    return new;
  end if;
  execute format('select organisation_id from %s where id = $1', tg_argv[1]) into org using pid;
  if org is null then
    raise exception 'parent_not_found: %', pid using errcode = 'foreign_key_violation';
  end if;
  if org <> new.organisation_id then
    raise exception 'parent_in_other_organisation: %', col using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function parent_check() is
  'Trigger of a foreign key to a parent (its column, then the parent''s table): the parent is in the same organisation.';

-- AFTER DELETE on the table of a kind, tg_argv[0] being the kind: what was
-- attached to the row goes with it. An attachment is a table with an
-- `object_kind` and an `object_id` column (or `subject_kind` and
-- `subject_id`): the core's attributes, identifiers, documents and series,
-- and a module's table about an object of the core (a task, a horizon).
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
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where a.attname in ('object_kind', 'subject_kind') and not a.attisdropped
       and c.relkind in ('r', 'p') and not c.relispartition
       and exists (select 1 from pg_attribute i where i.attrelid = c.oid and i.attname = left(a.attname, -5) || '_id' and not i.attisdropped)
  loop
    execute format('delete from %s where %I = $1 and %I = $2', t.table_name, t.side || '_kind', t.side || '_id')
      using tg_argv[0], old.id;
  end loop;
  return old;
end;
$$;

comment on function drop_attachments() is
  'AFTER DELETE on the table of a kind: deletes what was attached to the row, in every table with an object_kind and object_id (or subject_kind and subject_id) column.';

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

grant execute on function object_organisation(text, uuid),
  metric_srid(geometry), area_m2(geometry), to_core_geometry(geometry),
  place_check(jsonb)
  to authenticated, service_role;
