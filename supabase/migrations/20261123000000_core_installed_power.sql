-- Nexgen OS — core: the installed power of a participant or a project is
-- read from its devices.
--
-- A value is written once (decision 0065). The power of a device is its
-- `rated_power_kw`; the installed power of a participant is the sum of the
-- rated powers of the electricity-producing devices behind its meters, and
-- a project's the sum over its participants. Nobody enters that sum beside
-- the devices: `installed_power()` computes it, and the one reader of an
-- attribute, `attribute_at()`, answers it for the attribute type
-- `installed_power` — so `parameter_of()`, the indicators that divide by it
-- (`specific_yield`, `performance_ratio`) and the conditions that compare
-- it (`condition_matches()`, `actions.plan()`) read the devices, each
-- through the path it already had.
--
-- The attribute declared by hand stays what it was for a participant or a
-- project whose devices are not described — an installation that predates
-- this migration, a study that knows a total and no device yet: it is read
-- when no producing device carries a power, and never when one does.
-- Nothing is deleted and nothing is refused.

set search_path = nexgen, extensions;

create or replace function installed_power(p_object_id uuid, p_at timestamptz default now())
returns numeric
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select sum(d.rated_power_kw)
    from devices d
    join participants pa on pa.id = d.participant_id
   where (pa.id = p_object_id or pa.project_id = p_object_id)
     and d.rated_power_kw is not null
     and (d.removal_date is null or d.removal_date > p_at::date)
     and device_type_is_a(d.device_type, 'generator');
$$;

comment on function installed_power(uuid, timestamptz) is
  'The installed power of a participant or of a project at a moment, in kW: the sum of the rated powers of the electricity-producing devices (type generator and its refinements) behind the participant, or behind the participants of the project, that are not removed at that moment. A planned device counts: a project under study describes what will be installed. Null when no such device carries a power.';

-- The attribute of one object holding at a moment. The installed power of
-- a participant or a project whose devices carry it is theirs: the row
-- answered is then computed, never stored, and bears the object's own id.
create or replace function attribute_at(p_object_id uuid, p_attribute_type text, p_at timestamptz)
returns attributes
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  a  attributes%rowtype;
  v  numeric;
begin
  if p_attribute_type = 'installed_power' then
    v := installed_power(p_object_id, p_at);
    if v is not null then
      a.id := p_object_id;
      a.object_id := p_object_id;
      a.object_kind := case when exists (select 1 from projects where id = p_object_id) then 'project' else 'participant' end;
      a.organisation_id := object_organisation(a.object_kind, p_object_id);
      a.attribute_type := p_attribute_type;
      a.value := to_jsonb(v);
      a.source := 'the rated power of its devices (installed_power())';
      a.quality := 'estimated';
      return a;
    end if;
  end if;
  select x.* into a
    from attributes x
   where x.object_id = p_object_id and x.attribute_type = p_attribute_type
     and (x.valid_from is null or x.valid_from <= p_at)
     and (x.valid_to is null or x.valid_to > p_at)
   limit 1;
  return a;
end;
$$;

comment on function attribute_at(uuid, text, timestamptz) is
  'The attribute row of one object and attribute type holding at a moment; null when none. The installed power of a participant or a project whose producing devices carry a power is computed from them (installed_power()) and answered as a row that is stored nowhere, with the object''s id; the attribute declared by hand is read only when no device carries it.';

comment on column devices.rated_power_kw is
  'The rated power of the device in kW, written once: for a PV system its peak DC power (kWp), kept by the solar module equal to its arrays. The installed power of a participant or a project is the sum of these (installed_power()), never a figure entered beside them.';

grant execute on function installed_power(uuid, timestamptz) to authenticated, service_role;
