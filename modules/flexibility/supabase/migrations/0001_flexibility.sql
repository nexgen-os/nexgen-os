-- Nexgen OS — module `flexibility`: what a device can be asked, and the
-- power a generator can give up, interval by interval (decision 0058).
--
-- A flexible asset is a device, enriched with the same id
-- (`flexibility.devices`): the power it can be asked upwards and downwards
-- from its operating point, its ramp, its minimum step, the shortest and
-- longest activation it takes and the notice it needs. Any device type can
-- be flexible (a battery, a charger, a heat pump, a PV system curtailed), so
-- the table names the device by foreign key and no type is checked.
--
-- The first figure of the module is a read, stored nowhere:
-- `flexibility.power_down_available()` gives, bucket by bucket, the power a
-- generator can give up — its operating point read from its production
-- series, capped by the power downwards the device declares. The
-- production is written once, in its series; the availability is computed
-- from it each time it is read. Offers, activations and settlements, the
-- other three objects of decision 0058, come with their own migrations.
--
-- Conventions: powers in kW, the mean of a bucket; a bucket is dated at its
-- start, in UTC.

set search_path = nexgen, extensions;

create schema flexibility;
grant usage on schema flexibility to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- devices — what a device can be asked, same id.
-- ---------------------------------------------------------------------------

create table flexibility.devices (
  id                uuid primary key references devices(id) on delete cascade,
  -- Copied from the device by trigger, for row level security.
  organisation_id   uuid not null references organisations(id) on delete cascade,
  -- The power it can be asked above and below its operating point, kW;
  -- null: as far as its operating point allows (down to zero, up to its
  -- rated power).
  power_up_kw       numeric(12, 3),
  power_down_kw     numeric(12, 3),
  -- How fast its power can change when asked, kW per minute; null: not said.
  ramp_kw_per_min   numeric(12, 3),
  -- The smallest change of power it can be asked, kW; null: any.
  min_step_kw       numeric(12, 3),
  -- The shortest and longest activation it takes, and the time it needs to
  -- be ready once asked; null: not said.
  min_duration      interval,
  max_duration      interval,
  notice            interval,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint devices_power_non_negative check ((power_up_kw is null or power_up_kw >= 0) and (power_down_kw is null or power_down_kw >= 0)),
  constraint devices_ramp_positive check (ramp_kw_per_min is null or ramp_kw_per_min > 0),
  constraint devices_min_step_positive check (min_step_kw is null or min_step_kw > 0),
  constraint devices_durations check (
    (min_duration is null or min_duration > interval '0')
    and (max_duration is null or max_duration > interval '0')
    and (min_duration is null or max_duration is null or min_duration <= max_duration)
    and (notice is null or notice >= interval '0')
  )
);

comment on table flexibility.devices is
  'What a device of any type can be asked, same id: the power above and below its operating point (kW), its ramp (kW/min), its minimum step (kW), the shortest and longest activation and the notice it needs. Read with `from devices join flexibility.devices using (id)`.';

create or replace function flexibility.devices_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from devices where id = new.id);
  if new.organisation_id is null then
    raise exception 'device_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function flexibility.devices_organisation() is
  'BEFORE INSERT / UPDATE on devices: copies the organisation of the device; refuses device_not_found.';

create trigger devices_organisation before insert or update of id on flexibility.devices
  for each row execute function flexibility.devices_organisation();
create trigger devices_set_updated_at before update on flexibility.devices
  for each row execute function set_updated_at();
create index devices_organisation_idx on flexibility.devices (organisation_id);
call secure_table('flexibility.devices', null, 'participant_of(''device'', id)');

-- ---------------------------------------------------------------------------
-- power_down_available — what a generator can give up, bucket by bucket.
-- ---------------------------------------------------------------------------

create or replace function flexibility.power_down_available(
  p_series_id  uuid,
  p_from       timestamptz,
  p_to         timestamptz,
  p_step       interval default interval '15 minutes'
)
returns table (bucket timestamptz, operating_kw double precision, available_kw double precision, quality smallint)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  s     series%rowtype;
  q     quantities%rowtype;
  v_cap double precision;
begin
  select * into s from series where id = p_series_id;
  if not found then
    raise exception 'series_not_found: %', p_series_id using errcode = 'no_data_found';
  end if;
  if s.object_kind <> 'device' or s.quantity_code not in ('production_power', 'production_energy') then
    raise exception 'production_series_required: % is % of a %', p_series_id, s.quantity_code, s.object_kind
      using errcode = 'check_violation';
  end if;
  if s.kind not in ('measured', 'simulated', 'forecast') then
    raise exception 'production_series_required: % is a % series', p_series_id, s.kind
      using errcode = 'check_violation';
  end if;
  if p_step is null or p_step <= interval '0' or extract(year from p_step) <> 0 or extract(month from p_step) <> 0 then
    raise exception 'step_unsupported: %', p_step using errcode = 'invalid_parameter_value';
  end if;
  select * into q from quantities where code = s.quantity_code;
  select d.power_down_kw into v_cap from flexibility.devices d where d.id = s.object_id;

  return query
    select r.bucket,
           r.op,
           greatest(0, least(r.op, coalesce(v_cap, r.op))),
           r.quality
    from (
      select x.bucket,
             -- An energy per bucket is turned into its mean power.
             case when q.aggregation = 'sum'
                  then x.value / (extract(epoch from p_step) / 3600.0)
                  else x.value end as op,
             x.quality
      from resample(p_series_id, p_from, p_to, p_step) x
      where x.value is not null
    ) r
    order by r.bucket;
end;
$$;

comment on function flexibility.power_down_available(uuid, timestamptz, timestamptz, interval) is
  'The power a generator can give up, bucket by bucket (kW, the mean of the bucket, dated at its start): its operating point read from a production series of the device (production_power, or production_energy turned into its mean power), capped by the power_down_kw of flexibility.devices when the device declares one, never below zero. A bucket without a value is left out. Stored nowhere. Refuses series_not_found, production_series_required, step_unsupported, and what resample() refuses.';

grant execute on function flexibility.power_down_available(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('flexibility', 'Flexibility', '0.1.0', 'flexibility', '0.3.0',
        'What a device can be asked upwards and downwards from its operating point, with the same id, and the power a generator can give up interval by interval, read from its production series.');
