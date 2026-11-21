-- Nexgen OS — module `building`: the orientation of a face is read on
-- every PostGIS the module runs on.
--
-- building.surface_orientation() asked ST_HasZ() whether a polygon carries
-- heights. That function exists from PostGIS 3.5; a database on PostGIS 3.3
-- or 3.4 (a hosted Postgres often is) refused the call with "function
-- st_hasz(geometry) does not exist", and with it building.add_surface()
-- whenever the azimuth and the tilt were left to be read from the geometry.
--
-- The same question is asked with ST_NDims(), as the *_geometry_core
-- constraints of the module already do. A geometry of the module has three
-- dimensions or two, never a measure, so the answer is the same. Nothing
-- else of the function changes, and no stored row does.

set search_path = nexgen, extensions;

create or replace function building.surface_orientation(p_geom geometry, out azimuth_deg numeric, out tilt_deg numeric)
language plpgsql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  srid  int;
  m     geometry;
  pts   geometry[];
  nx    float8 := 0;
  ny    float8 := 0;
  nz    float8 := 0;
  h     float8;
  c     geometry;
  i     int;
begin
  if p_geom is null or ST_NDims(p_geom) <> 3 or GeometryType(p_geom) not in ('POLYGON', 'MULTIPOLYGON') then
    return;
  end if;
  srid := metric_srid(p_geom);
  m := ST_Transform(ST_GeometryN(p_geom, 1), srid);
  select array_agg(d.geom order by d.path) into pts from ST_DumpPoints(ST_ExteriorRing(m)) d;
  for i in 1 .. array_length(pts, 1) - 1 loop
    nx := nx + (ST_Y(pts[i]) - ST_Y(pts[i + 1])) * (ST_Z(pts[i]) + ST_Z(pts[i + 1]));
    ny := ny + (ST_Z(pts[i]) - ST_Z(pts[i + 1])) * (ST_X(pts[i]) + ST_X(pts[i + 1]));
    nz := nz + (ST_X(pts[i]) - ST_X(pts[i + 1])) * (ST_Y(pts[i]) + ST_Y(pts[i + 1]));
  end loop;
  if nx = 0 and ny = 0 and nz = 0 then
    return;
  end if;
  if nz < 0 then
    nx := -nx; ny := -ny; nz := -nz;
  end if;
  h := sqrt(nx * nx + ny * ny);
  tilt_deg := round(degrees(atan2(h, nz))::numeric, 2);
  if tilt_deg < 1 then
    return;
  end if;
  c := ST_Centroid(ST_Force2D(m));
  azimuth_deg := round(degrees(ST_Azimuth(
    ST_Transform(c, 4326)::geography,
    ST_Transform(ST_Translate(c, 10 * nx / h, 10 * ny / h), 4326)::geography))::numeric, 2);
  if azimuth_deg >= 360 then
    azimuth_deg := azimuth_deg - 360;
  end if;
end;
$$;

update nexgen.modules set version = '0.5.0' where code = 'building';
