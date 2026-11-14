-- Nexgen OS — module `building`: the georeferenced models of a building
-- or a ground.
--
-- A building is often also known by a three-dimensional model: the IFC of
-- the architect, the CityJSON tile of the city, the glTF of a PV layout, the
-- point cloud of a survey. The file stays in object storage; its row says
-- where it is, what it is and how it sits on the globe (decision 0008):
--
--   building.models           a model of a building or of a ground: its file
--                             (address, format, size, checksum), its placement
--                             (frame, origin, heading, scale, units, up axis,
--                             vertical datum), its bounds, its level of
--                             detail, the source's georeferencing block
--   building.model_to_world() a geometry in the model's coordinates, in WGS 84
--   building.model_footprint() the plan of a model's bounds, placed
--
-- A model is placed by data, the same way whatever its format. Its
-- coordinates are first taken to metres and to a z-up frame (`unit_m`,
-- `up_axis`), then turned and scaled in the plane and moved to its origin
-- (`heading_deg`, `scale`, `origin`) in its frame: the projected reference
-- system its file names (`srid`, as an IfcMapConversion or a CityJSON
-- `referenceSystem` says), or, when the file names none, a local frame at
-- its origin whose north is true north. Nothing of the building's own
-- numbers is kept beside it: a face measured on a model is a surface of the
-- building, with the model as its source.

set search_path = nexgen, extensions;

create table building.models (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A model of a building, or of a ground without one (a PV field, a car
  -- park), as a surface is on one or the other.
  building_id      uuid references building.buildings(id) on delete cascade,
  site_id          uuid references building.sites(id) on delete cascade,
  name             text not null,
  -- ifc, cityjson, citygml, gltf, glb, obj: meshes and models; las, laz,
  -- e57, ply: point clouds.
  format           text not null,
  -- The file: where it is (object storage, a public URL), its media type,
  -- its size in bytes and its checksum with its algorithm (`sha256:<hex>`),
  -- as the core describes a document. Never its bytes.
  uri              text not null,
  media_type       text,
  byte_size        bigint,
  checksum         text,
  -- Its placement. The projected reference system its coordinates are in
  -- (an EPSG code), or null for a local frame at its origin, true north up.
  srid             integer,
  -- Where the model's (0, 0, 0) is on the globe, in WGS 84, with its
  -- height above the vertical datum.
  origin           geometry not null,
  -- The azimuth of the model's +Y axis (its north once z is up), degrees
  -- clockwise from the frame's north: grid north of `srid`, true north in a
  -- local frame.
  heading_deg      numeric(9, 6) not null default 0,
  -- Metres of the frame per metre of the model, in the plane (the scale of
  -- an IfcMapConversion; 1 for most files).
  scale            numeric(12, 9) not null default 1,
  -- The length of one model unit in metres: 1 for metres, 0.001 for
  -- millimetres or a CityJSON transform scale of 0.001.
  unit_m           numeric(12, 9) not null default 1,
  -- z: the model's z axis points up (IFC, CityJSON); y: its y axis does
  -- (glTF), and its north is -z.
  up_axis          text not null default 'z',
  -- What the heights are measured from: `ellipsoid`, or a vertical
  -- reference system (`EPSG:5709`). Null when the file does not say.
  vertical_datum   text,
  -- The model's bounding box in its own coordinates and units: min x, y, z,
  -- max x, y, z.
  bounds           numeric[],
  -- The level of detail its file declares (CityJSON `2.2`, LOD 300).
  lod              text,
  -- The georeferencing block as the file gave it (an IfcMapConversion and
  -- its IfcProjectedCRS, a CityJSON transform and metadata), so that
  -- nothing it said is lost.
  georeference     jsonb not null default '{}',
  source_code      text references sources(code),
  captured_at      timestamptz,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint models_name_not_blank check (btrim(name) <> ''),
  constraint models_one_host check ((building_id is null) <> (site_id is null)),
  constraint models_format check (format in ('ifc', 'cityjson', 'citygml', 'gltf', 'glb', 'obj', 'las', 'laz', 'e57', 'ply')),
  constraint models_uri_not_blank check (btrim(uri) <> ''),
  constraint models_size check (byte_size is null or byte_size >= 0),
  constraint models_checksum check (checksum is null or checksum ~ '^[a-z0-9]+:[0-9a-f]+$'),
  constraint models_origin_core check (GeometryType(origin) = 'POINT' and ST_SRID(origin) = 4326 and ST_NDims(origin) = 3),
  constraint models_heading_range check (heading_deg >= 0 and heading_deg < 360),
  constraint models_scale_positive check (scale > 0),
  constraint models_unit_positive check (unit_m > 0),
  constraint models_up_axis check (up_axis in ('y', 'z')),
  constraint models_bounds check (bounds is null or (array_length(bounds, 1) = 6 and bounds[1] <= bounds[4] and bounds[2] <= bounds[5] and bounds[3] <= bounds[6]))
);

comment on table building.models is
  'A georeferenced model of a building or a ground: an IFC, a CityJSON, a glTF, a point cloud. The file stays in object storage; the row holds its address, format, size and checksum, how it is placed on the globe (frame, origin, heading, scale, units, up axis, vertical datum), its bounds and the source''s georeferencing block (decision 0008).';

create index models_building_idx on building.models (building_id);
create index models_site_idx on building.models (site_id);
create index models_organisation_idx on building.models (organisation_id);
create index models_origin_idx on building.models using gist (origin);
-- One file is one model of an organisation: a file is imported once.
create unique index models_one_checksum on building.models (organisation_id, checksum);
create trigger models_building_id_check before insert or update of building_id on building.models
  for each row execute function parent_check('building_id', 'building.buildings');
create trigger models_site_id_check before insert or update of site_id on building.models
  for each row execute function parent_check('site_id', 'building.sites');
create trigger models_set_updated_at before update on building.models
  for each row execute function set_updated_at();
call secure_table('building.models');

-- A geometry in a model's coordinates, placed in WGS 84: to metres and z up,
-- turned by the heading and scaled in the plane, moved to the origin in the
-- model's frame, then taken to WGS 84.
create or replace function building.model_to_world(p_model_id uuid, p_local geometry)
returns geometry
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  m     building.models%rowtype;
  g     geometry;
  o     geometry;
  h     float8;
  k     float8;
  u     float8;
  frame text;
begin
  select * into m from building.models where id = p_model_id;
  if not found then
    raise exception 'model_not_found: %', p_model_id using errcode = 'no_data_found';
  end if;
  if p_local is null then
    return null;
  end if;
  g := ST_Force3D(ST_SetSRID(p_local, 0));
  if m.up_axis = 'y' then
    -- (x, y, z) with y up and -z north → (x, -z, y).
    g := ST_Affine(g, 1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0);
  end if;
  h := radians(m.heading_deg);
  u := m.unit_m;
  k := m.scale * u;
  if m.srid is not null then
    o := ST_Transform(m.origin, m.srid);
    g := ST_Affine(g, k * cos(h), k * sin(h), 0, -k * sin(h), k * cos(h), 0, 0, 0, u,
                   ST_X(o), ST_Y(o), ST_Z(m.origin));
    return ST_Transform(ST_SetSRID(g, m.srid), 4326);
  end if;
  -- A transverse Mercator centred on the origin: grid north is true north
  -- there, and the grid is in metres.
  frame := format('+proj=tmerc +lat_0=%s +lon_0=%s +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
                  ST_Y(m.origin), ST_X(m.origin));
  g := ST_Affine(g, k * cos(h), k * sin(h), 0, -k * sin(h), k * cos(h), 0, 0, 0, u, 0, 0, ST_Z(m.origin));
  return ST_Transform(g, frame, 4326);
end;
$$;

comment on function building.model_to_world(uuid, geometry) is
  'A geometry in a model''s coordinates and units, placed in WGS 84 by the model''s frame, origin, heading, scale, units and up axis. Refuses model_not_found.';

-- The plan of a model's bounds at their lowest height, placed: where the
-- model stands, to compare with the footprint of its building.
create or replace function building.model_footprint(p_model_id uuid)
returns geometry
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select building.model_to_world(m.id, case
           when m.bounds is null then null
           when m.up_axis = 'y' then ST_MakePolygon(ST_MakeLine(array[
             ST_MakePoint(m.bounds[1], m.bounds[2], m.bounds[3]), ST_MakePoint(m.bounds[4], m.bounds[2], m.bounds[3]),
             ST_MakePoint(m.bounds[4], m.bounds[2], m.bounds[6]), ST_MakePoint(m.bounds[1], m.bounds[2], m.bounds[6]),
             ST_MakePoint(m.bounds[1], m.bounds[2], m.bounds[3])]))
           else ST_MakePolygon(ST_MakeLine(array[
             ST_MakePoint(m.bounds[1], m.bounds[2], m.bounds[3]), ST_MakePoint(m.bounds[4], m.bounds[2], m.bounds[3]),
             ST_MakePoint(m.bounds[4], m.bounds[5], m.bounds[3]), ST_MakePoint(m.bounds[1], m.bounds[5], m.bounds[3]),
             ST_MakePoint(m.bounds[1], m.bounds[2], m.bounds[3])]))
         end)
    from building.models m where m.id = p_model_id;
$$;

comment on function building.model_footprint(uuid) is
  'The plan of a model''s bounding box at its lowest height, placed in WGS 84 (model_to_world). Null without bounds.';

-- A model of a building or a ground, placed by its values. The origin is
-- given in the model's frame (`p_srid`), or in WGS 84 when it has none.
create or replace function building.add_model(
  p_host_id         uuid,
  p_name            text,
  p_format          text,
  p_uri             text,
  p_origin          geometry,
  p_srid            integer default null,
  p_heading_deg     numeric default 0,
  p_scale           numeric default 1,
  p_unit_m          numeric default 1,
  p_up_axis         text default 'z',
  p_vertical_datum  text default null,
  p_bounds          numeric[] default null,
  p_lod             text default null,
  p_checksum        text default null,
  p_byte_size       bigint default null,
  p_media_type      text default null,
  p_georeference    jsonb default '{}',
  p_source_code     text default null,
  p_captured_at     timestamptz default null,
  p_metadata        jsonb default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id   uuid := gen_random_uuid();
  host   record;
  known  uuid;
  origin geometry;
begin
  select 'building' as kind, b.organisation_id into host from building.buildings b where b.id = p_host_id;
  if not found then
    select 'site' as kind, s.organisation_id into host from building.sites s where s.id = p_host_id;
  end if;
  if host.kind is null then
    raise exception 'model_host_kind: a model is of a building or of a ground (a site)' using errcode = 'check_violation';
  end if;
  if p_origin is null or GeometryType(p_origin) <> 'POINT' then
    raise exception 'model_origin_required: a model is placed by the point its (0, 0, 0) lands on' using errcode = 'invalid_parameter_value';
  end if;
  if p_srid is not null and not exists (select 1 from spatial_ref_sys where srid = p_srid) then
    raise exception 'crs_unknown: EPSG:% is not in spatial_ref_sys', p_srid using errcode = 'invalid_parameter_value';
  end if;
  select id into known from building.models where organisation_id = host.organisation_id and checksum = p_checksum;
  if known is not null then
    raise exception 'already_imported: file % is model % of this organisation', p_checksum, known using errcode = 'unique_violation';
  end if;
  origin := ST_Force3D(p_origin);
  origin := case
    when p_srid is not null then ST_Transform(ST_SetSRID(origin, p_srid), 4326)
    when ST_SRID(origin) in (0, 4326) then ST_SetSRID(origin, 4326)
    else ST_Transform(origin, 4326)
  end;
  insert into building.models (id, organisation_id, building_id, site_id, name, format, uri, media_type, byte_size, checksum,
                               srid, origin, heading_deg, scale, unit_m, up_axis, vertical_datum, bounds, lod,
                               georeference, source_code, captured_at, metadata)
  values (v_id, host.organisation_id,
          case when host.kind = 'building' then p_host_id end, case when host.kind = 'site' then p_host_id end,
          p_name, p_format, p_uri, p_media_type, p_byte_size, p_checksum,
          p_srid, origin, mod(mod(coalesce(p_heading_deg, 0), 360) + 360, 360), coalesce(p_scale, 1), coalesce(p_unit_m, 1),
          coalesce(p_up_axis, 'z'), p_vertical_datum, p_bounds, p_lod,
          coalesce(p_georeference, '{}'), p_source_code, p_captured_at, coalesce(p_metadata, '{}'));
  return v_id;
end;
$$;

comment on function building.add_model(uuid, text, text, text, geometry, integer, numeric, numeric, numeric, text, text, numeric[], text, text, bigint, text, jsonb, text, timestamptz, jsonb) is
  'Describes a georeferenced model of a building or a ground (a site): its file by address, format, size and checksum, its placement by origin (in the frame p_srid names, else in WGS 84), heading, scale, units, up axis and vertical datum, its bounds and the source''s georeferencing block. Refuses model_host_kind, model_origin_required, crs_unknown, already_imported. Returns its id.';

-- The participant of a model, beside those of the other objects of the
-- module.
create or replace function building.participant_of(p_kind text, p_id uuid)
returns uuid
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select case p_kind
    when 'site' then (select s.participant_id from building.sites s where s.id = p_id)
    when 'building' then (select b.participant_id from building.buildings b where b.id = p_id)
    when 'space' then (select b.participant_id from building.spaces sp join building.buildings b on b.id = sp.building_id where sp.id = p_id)
    when 'surface' then (select coalesce(s.participant_id, b.participant_id) from building.surfaces f
                           left join building.buildings b on b.id = f.building_id
                           left join building.sites s on s.id = f.site_id where f.id = p_id)
    when 'model' then (select coalesce(s.participant_id, b.participant_id) from building.models md
                         left join building.buildings b on b.id = md.building_id
                         left join building.sites s on s.id = md.site_id where md.id = p_id)
  end;
$$;

comment on function building.participant_of(text, uuid) is
  'The participant a site, a building, a space, a surface or a model belongs to, through their foreign keys.';

grant execute on function building.model_to_world(uuid, geometry), building.model_footprint(uuid),
  building.add_model(uuid, text, text, text, geometry, integer, numeric, numeric, numeric, text, text, numeric[], text, text, bigint, text, jsonb, text, timestamptz, jsonb)
  to authenticated, service_role;

update nexgen.modules set version = '0.4.0' where code = 'building';
