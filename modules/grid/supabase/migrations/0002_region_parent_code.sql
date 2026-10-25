-- Nexgen OS — module `grid`: the region a region is part of is its
-- parent_code (decision 0057).
--
-- The core renamed `regions.parent` to `regions.parent_code` in 0.4.0, the
-- name of the column that points at the parent row in every tree of the
-- core. The operator of a meter climbs the regions by it; the function is
-- otherwise the one of 0001_grid.

set search_path = nexgen, extensions;

create or replace function grid.operator_of(p_meter_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  m        meters%rowtype;
  p        participants%rowtype;
  v_code   text;
  v_prefix text;
  v_muni   text;
  v_region text;
  v_seen   text[] := '{}';
  n        integer;
begin
  select * into m from meters where id = p_meter_id;
  if not found then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
  select * into p from participants where id = m.participant_id;

  select gm.grid_operator into v_code from grid.meters gm where gm.id = m.id and gm.grid_operator is not null;
  if v_code is not null then
    return jsonb_build_object('operator', v_code, 'by', 'meter');
  end if;

  select o.code, x.prefix into v_code, v_prefix
    from grid.operators o, unnest(o.identifier_prefixes) x(prefix)
   where o.country = p.country and (o.identifier_scheme is null or o.identifier_scheme = m.scheme)
     and m.identifier like x.prefix || '%'
   order by length(x.prefix) desc, o.code
   limit 1;
  if v_code is not null then
    return jsonb_build_object('operator', v_code, 'by', 'prefix', 'prefix', v_prefix);
  end if;

  v_muni := municipality_of(p.id);
  if v_muni is not null then
    select o.code into v_code from grid.operators o
     where o.country = p.country and o.kind <> 'tso' and v_muni = any (o.municipalities)
     order by o.code limit 1;
    if v_code is not null then
      return jsonb_build_object('operator', v_code, 'by', 'municipality', 'municipality', v_muni);
    end if;
  end if;

  v_region := coalesce(v_muni, p.region);
  while v_region is not null and not v_region = any (v_seen) loop
    v_seen := v_seen || v_region;
    select count(*), min(o.code) into n, v_code from grid.operators o
     where o.country = p.country and o.kind <> 'tso' and v_region = any (o.regions);
    if n = 1 then
      return jsonb_build_object('operator', v_code, 'by', 'region', 'region', v_region);
    end if;
    exit when n > 1;
    select r.parent_code into v_region from regions r where r.code = v_region;
  end loop;

  raise exception 'grid_operator_not_found: no operator of % says it runs meter % (identifier %, %)', coalesce(p.country, 'its country'),
    m.id, m.identifier, coalesce(v_muni, p.region, 'no region')
    using errcode = 'no_data_found';
end;
$$;

comment on function grid.operator_of(uuid) is
  'The operator that runs a connection point of the core, from the most precise level up: the one named on the point (grid.meters), the longest identifier prefix an operator of its country issues, an operator serving the municipality of its participant''s place, the one distribution operator of its region or of a region above it — {operator, by, and the prefix, municipality or region that decided}. Refuses meter_not_found, grid_operator_not_found.';
