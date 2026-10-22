-- Nexgen OS — module `weather`: which weather a place reads.
--
-- Weather belongs to a place, not to a device: two PV systems of one
-- participant share it, its heat pump reads the same temperature. This
-- module holds what every other module needs to read it (decision 0012,
-- "Weather: a module of its own, chosen per place"):
--
--   models   which sources are weather models, for what, at which
--            resolution, and on which grid
--   rules    what a pack or an installation decides for a country or a
--            region
--   points   the grid cell or the station a participant reads; its
--            weather series are stored once, whatever the number of
--            participants in it, as series of the organisation named by
--            the point (`series.name` the point's name, `external_ref` its
--            id, `source_code` its model)
--   participant_points   which point each participant reads, a row per
--            participant and point
--
-- A participant may pin a model through the attribute `weather_source`.
-- `weather.source_for()` resolves the model for one participant and one
-- purpose; `weather.point_for()` finds or creates the point and says the
-- participant reads it. The database calls no weather API: connectors write
-- the series of the points.

set search_path = nexgen, public, extensions;

create schema weather;
grant usage on schema weather to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- models — the sources that are weather models.
-- ---------------------------------------------------------------------------

create table weather.models (
  source_code   text primary key references sources(code) on delete cascade,
  -- What the model can be read for: irradiance, temperature, wind (the
  -- quantities), typical_year (a typical meteorological year), history
  -- (observations or reanalysis of the past), forecast.
  purposes      text[] not null,
  -- The size of one cell (or the reach of one station), in metres.
  resolution_m  integer,
  -- The rounding of longitude and latitude, in degrees, that identifies a
  -- cell: two positions rounded to the same values read the same cell.
  -- Null for a network of stations, where each position is its own point.
  grid_deg      numeric,
  -- Lower is preferred when several models cover a place for a purpose.
  priority      integer not null default 100,
  published_by  text not null default 'weather',
  constraint models_purposes_known check (
    cardinality(purposes) > 0
    and purposes <@ array['irradiance', 'temperature', 'wind', 'typical_year', 'history', 'forecast']
  ),
  constraint models_resolution_positive check (resolution_m is null or resolution_m > 0),
  constraint models_grid_positive check (grid_deg is null or grid_deg > 0)
);

comment on table weather.models is
  'The sources that are weather models: what each can be read for, its resolution, the grid that identifies a cell, and its priority. Coverage (countries, regions), licence and retention are those of the source.';

-- ---------------------------------------------------------------------------
-- rules — what a pack or an installation decides for a place.
-- ---------------------------------------------------------------------------

create table weather.rules (
  id            uuid primary key default gen_random_uuid(),
  -- ISO 3166-1 alpha-2.
  country       char(2) not null,
  -- ISO 3166-2 subdivisions the rule is limited to; empty = the whole
  -- country. A regional rule wins over a rule for the whole country.
  regions       text[] not null default '{}',
  purpose       text not null,
  source_code   text not null references weather.models(source_code) on delete cascade,
  -- Lower is preferred among rules of the same reach.
  priority      integer not null default 100,
  -- The pack (`pack:xx`) or the installation that decided it.
  published_by  text not null,
  constraint rules_country_format check (country ~ '^[A-Z]{2}$'),
  constraint rules_purpose_known check (purpose in ('irradiance', 'temperature', 'wind', 'typical_year', 'history', 'forecast'))
);

comment on table weather.rules is
  'The weather model a country or a region reads for one purpose, as a pack or an installation decides it. The core seeds none.';

create index rules_country_idx on weather.rules (country, purpose);

-- Models and rules are vocabularies: read by everyone signed in, written by
-- migrations, packs and the installation.
do $$
declare
  t text;
begin
  foreach t in array array['weather.models', 'weather.rules'] loop
    execute format('alter table %s enable row level security', t);
    execute format('create policy %I on %s for select to authenticated using (true)', replace(t, '.', '_') || '_read', t);
    execute format('grant select on %s to authenticated', t);
    execute format('grant select, insert, update, delete on %s to service_role', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- points — the cell or the station a participant reads.
-- ---------------------------------------------------------------------------

create table weather.points (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  source_code      text not null references weather.models(source_code),
  -- The grid point or the station, as a point.
  geometry         geometry not null,
  resolution_m     integer,
  -- The cell the point stands for: its position rounded with the model's
  -- grid_deg (exact for a station). Set by trigger, never written by hand.
  cell_lon         numeric,
  cell_lat         numeric,
  -- What the model said about the point beyond these columns: its own
  -- elevation, the station's identifier, the grid's name.
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint points_name_not_blank check (btrim(name) <> ''),
  constraint points_geometry_point check (GeometryType(geometry) = 'POINT' and ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3),
  constraint points_resolution_positive check (resolution_m is null or resolution_m > 0)
);

comment on table weather.points is
  'A grid cell or a station of a weather model that participants read (participant_points). Its weather series are stored once, as series of the organisation named by the point, whatever the number of participants that read it.';

-- One point per cell of a model in an organisation.
create unique index points_one_per_cell on weather.points
  (organisation_id, source_code, cell_lon, cell_lat);
create index points_geometry_idx on weather.points using gist (geometry);
create trigger weather_points_normalize before insert or update of geometry on weather.points
  for each row execute function normalize_geometry('geometry');
create trigger points_set_updated_at before update on weather.points
  for each row execute function set_updated_at();
create index points_organisation_idx on weather.points (organisation_id);
call secure_table('weather.points');

-- ---------------------------------------------------------------------------
-- participant_points — which point each participant reads.
-- ---------------------------------------------------------------------------

create table weather.participant_points (
  participant_id   uuid not null references participants(id) on delete cascade,
  point_id         uuid not null references weather.points(id) on delete cascade,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (participant_id, point_id)
);

comment on table weather.participant_points is
  'The weather point (grid cell or station) a participant reads its weather from, one row per participant and point.';

create index participant_points_point_idx on weather.participant_points (point_id);
create trigger participant_points_participant_id_check before insert or update of participant_id on weather.participant_points
  for each row execute function parent_check('participant_id', 'participants');
create trigger participant_points_point_id_check before insert or update of point_id on weather.participant_points
  for each row execute function parent_check('point_id', 'weather.points');
call secure_table('weather.participant_points');


-- The cell of a position for a model: longitude and latitude rounded to the
-- model's grid, or exact when the model has none (a station).
create or replace function weather.cell_of(p_position geometry, p_grid_deg numeric)
returns numeric[]
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select case
           when p_grid_deg is null then array[ST_X(p_position)::numeric, ST_Y(p_position)::numeric]
           else array[trim_scale(round(ST_X(p_position)::numeric / p_grid_deg) * p_grid_deg),
                      trim_scale(round(ST_Y(p_position)::numeric / p_grid_deg) * p_grid_deg)]
         end;
$$;

comment on function weather.cell_of(geometry, numeric) is
  'The cell a WGS 84 position falls in on a grid of p_grid_deg degrees, as {longitude, latitude}; the exact position when the grid is null.';

-- BEFORE INSERT / UPDATE: computes the cell. Triggers fire in name order, so
-- this one (`..._set_cell`) runs after `..._normalize` and reads the
-- geometry already in EPSG:4326.
create or replace function weather.points_set_cell()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  c numeric[];
begin
  c := weather.cell_of(new.geometry, (select grid_deg from weather.models where source_code = new.source_code));
  new.cell_lon := c[1];
  new.cell_lat := c[2];
  return new;
end;
$$;

create trigger weather_points_set_cell before insert or update of geometry, source_code on weather.points
  for each row execute function weather.points_set_cell();

-- ---------------------------------------------------------------------------
-- Vocabulary rows the module publishes.
-- ---------------------------------------------------------------------------

insert into weather.models (source_code, purposes, resolution_m, grid_deg, priority, published_by) values
  -- PVGIS: SARAH3 satellite irradiance and typical years, about 5 km.
  ('pvgis',      '{irradiance,typical_year}',                         5000, 0.05, 10, 'weather'),
  -- Open-Meteo: ERA5 and national models blended, history and forecast.
  ('open_meteo', '{irradiance,temperature,wind,history,forecast}',     1000, 0.01, 20, 'weather');

insert into property_defs (code, name, description, datatype, applies_to, published_by) values
  ('weather_source', 'Weather source',
   'The weather model (a source code of weather.models) a participant or a project reads, pinned against the rules and the defaults.',
   'text', '{participant,project}', 'weather');

-- ---------------------------------------------------------------------------
-- source_for — the model one participant reads for one purpose.
-- ---------------------------------------------------------------------------

create or replace function weather.source_for(p_participant_id uuid, p_purpose text)
returns text
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s       participants%rowtype;
  pinned  text;
  found_code text;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;

  -- (a) The participant's own choice, when that model serves the purpose.
  pinned := attributes_of(p_participant_id, now()) ->> 'weather_source';
  if pinned is not null then
    select m.source_code into found_code
      from weather.models m
     where m.source_code = pinned and p_purpose = any (m.purposes);
    if found_code is not null then
      return found_code;
    end if;
  end if;

  -- (b) An active connector of the organisation to a model for that
  -- purpose (its config may restrict it to one purpose).
  select m.source_code into found_code
    from connectors c
    join weather.models m on m.source_code = c.source_code
   where c.organisation_id = s.organisation_id
     and c.status = 'active'
     and p_purpose = any (m.purposes)
     and (c.config ->> 'purpose' is null or c.config ->> 'purpose' = p_purpose)
   order by (c.config ->> 'purpose' is null), m.priority, c.created_at
   limit 1;
  if found_code is not null then
    return found_code;
  end if;

  -- (c) The rule of the participant's region, then of its whole country.
  select r.source_code into found_code
    from weather.rules r
   where r.country = s.country
     and r.purpose = p_purpose
     and (cardinality(r.regions) = 0 or s.region = any (r.regions))
   order by cardinality(r.regions) = 0, r.priority, r.id
   limit 1;
  if found_code is not null then
    return found_code;
  end if;

  -- (d) The preferred model that covers the participant's country and region.
  select m.source_code into found_code
    from weather.models m
    join sources src on src.code = m.source_code
   where p_purpose = any (m.purposes)
     and (cardinality(src.countries) = 0 or s.country = any (src.countries))
     and (cardinality(src.regions) = 0 or s.region = any (src.regions))
   order by m.priority, m.source_code
   limit 1;
  if found_code is not null then
    return found_code;
  end if;

  raise exception 'weather_source_unknown: no weather model for % at participant %', p_purpose, p_participant_id
    using errcode = 'no_data_found';
end;
$$;

comment on function weather.source_for(uuid, text) is
  'The weather model a participant reads for a purpose: the participant''s attribute weather_source, else an active connector of its organisation, else the rule of its region then its country, else the preferred model covering it. Named error weather_source_unknown when none.';

-- ---------------------------------------------------------------------------
-- point_for — the point one participant reads for one model.
-- ---------------------------------------------------------------------------

create or replace function weather.point_for(p_participant_id uuid, p_source_code text)
returns uuid
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s         participants%rowtype;
  m         weather.models%rowtype;
  position  geometry;
  c         numeric[];
  point_id  uuid;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  select * into m from weather.models where source_code = p_source_code;
  if not found then
    raise exception 'weather_source_unknown: % is not a weather model', p_source_code using errcode = 'no_data_found';
  end if;

  position := ST_Centroid(s.geometry);
  if position is null then
    raise exception 'participant_without_position: %', p_participant_id using errcode = 'invalid_parameter_value';
  end if;
  c := weather.cell_of(position, m.grid_deg);

  select p.id into point_id
    from weather.points p
   where p.organisation_id = s.organisation_id
     and p.source_code = m.source_code
     and p.cell_lon = c[1] and p.cell_lat = c[2];

  if point_id is null then
    insert into weather.points (organisation_id, name, source_code, geometry, resolution_m)
    values (s.organisation_id,
            (select name from sources where code = m.source_code) || ' ' || c[2] || ', ' || c[1],
            m.source_code,
            -- The cell's centre, or the station itself.
            ST_SetSRID(ST_MakePoint(c[1], c[2]), 4326),
            m.resolution_m)
    returning id into point_id;
  end if;

  insert into weather.participant_points (participant_id, point_id, organisation_id)
  values (p_participant_id, point_id, s.organisation_id)
  on conflict do nothing;

  return point_id;
end;
$$;

comment on function weather.point_for(uuid, text) is
  'The weather point a participant reads for a model: the organisation''s point in the model''s cell of the participant''s position, created when missing, and records that the participant reads it (participant_points). Named error participant_without_position when the participant has no geometry.';

grant execute on function weather.cell_of(geometry, numeric), weather.source_for(uuid, text), weather.point_for(uuid, text)
  to authenticated, service_role;
grant execute on function weather.points_set_cell() to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('weather', 'Weather', '0.1.0', 'weather', '0.1.0',
        'Weather points participants are linked to, weather models as sources, and the model each participant reads, resolved from its attribute, its organisation, the pack and the coverage.');
