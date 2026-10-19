-- Nexgen OS — module `tasks`: a template says the regions it holds in.
--
-- Some countries decide by region: in Belgium, Flanders, Brussels and
-- Wallonia each set their own permits, regulator and rules on energy
-- sharing. A template carries its regions (ISO 3166-2) as a rule does; no
-- region means the whole country. `tasks.plan()` reads the regions of the
-- sites taking part in the project and keeps the templates of those
-- regions; a regional template on a project none of whose sites says its
-- region is skipped and said so (`region_missing`), never guessed.

set search_path = nexgen, public, extensions;

alter table tasks.templates add column regions text[] not null default '{}';

comment on column tasks.templates.regions is
  'The ISO 3166-2 regions of the country the template holds in; empty: the whole country.';

create or replace function tasks.plan(p_project_id uuid, p_scenario_id uuid default null)
returns jsonb
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_country   char(2);
  v_kind      text;
  v_org       uuid;
  v_created   integer := 0;
  v_existing  integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_value     numeric;
  v_wanted    numeric;
  v_applies   boolean;
  v_regions   text[];
  t           record;
begin
  select p.country, p.kind, p.organisation_id into v_country, v_kind, v_org from community.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;

  -- The regions of a project are those of the sites taking part in it.
  select coalesce(array_agg(distinct s.region order by s.region), '{}') into v_regions
    from community.participants pa
    join sites s on s.id = pa.site_id
   where pa.project_id = p_project_id and s.region is not null;

  for t in
    select * from tasks.templates tp
     where (tp.country is null or tp.country = v_country)
       and (tp.project_kind is null or tp.project_kind = v_kind)
     order by tp.position, tp.code
  loop
    if exists (select 1 from tasks.tasks x
                where x.subject_id = p_project_id and x.template_id = t.id
                  and x.scenario_id is not distinct from p_scenario_id) then
      v_existing := v_existing + 1;
      continue;
    end if;

    if t.regions <> '{}' then
      if v_regions = '{}' then
        v_skipped := v_skipped || jsonb_build_object('code', t.code, 'published_by', t.published_by,
                                                     'reason', 'region_missing', 'regions', to_jsonb(t.regions));
        continue;
      end if;
      if not t.regions && v_regions then
        continue;
      end if;
    end if;

    if t.applies_when is not null then
      -- An attribute's value is JSON; the core keeps a number property's
      -- value a JSON number.
      select case when jsonb_typeof(a.value) = 'number' then (a.value #>> '{}')::numeric end into v_value
        from attributes a
       where a.object_id = p_project_id and a.property_code = t.applies_when->>'property'
       limit 1;
      if v_value is null then
        v_skipped := v_skipped || jsonb_build_object('code', t.code, 'published_by', t.published_by,
                                                     'reason', 'attribute_missing', 'property', t.applies_when->>'property');
        continue;
      end if;
      v_wanted := (t.applies_when->>'value')::numeric;
      v_applies := case t.applies_when->>'op'
                     when '='  then v_value =  v_wanted
                     when '<>' then v_value <> v_wanted
                     when '<'  then v_value <  v_wanted
                     when '<=' then v_value <= v_wanted
                     when '>'  then v_value >  v_wanted
                     when '>=' then v_value >= v_wanted
                   end;
      if not v_applies then
        continue;
      end if;
    end if;

    insert into tasks.tasks (organisation_id, subject_id, phase, role, name, notes, source, template_id, scenario_id)
    values (v_org, p_project_id, t.phase, t.role, t.name, t.description, 'template', t.id, p_scenario_id);
    v_created := v_created + 1;
  end loop;

  -- A task waits for the task its template waits for, when both exist here.
  update tasks.tasks x
     set depends_on = d.id
    from tasks.templates tp
    join tasks.templates dt on dt.published_by = tp.published_by and dt.code = tp.depends_on_code
    join tasks.tasks d on d.template_id = dt.id and d.subject_id = p_project_id
                      and d.scenario_id is not distinct from p_scenario_id
   where x.template_id = tp.id and x.subject_id = p_project_id
     and x.scenario_id is not distinct from p_scenario_id
     and x.depends_on is null;

  return jsonb_build_object('project_id', p_project_id, 'created', v_created, 'existing', v_existing, 'skipped', v_skipped);
end;
$$;

comment on function tasks.plan(uuid, uuid) is
  'Creates the tasks of a project from the templates that match its country, the regions of its sites, its kind and its attributes, once; says what it created, what already was there and what it could not decide. Writes under the caller''s row level security.';

grant execute on function tasks.plan(uuid, uuid) to authenticated, service_role;
