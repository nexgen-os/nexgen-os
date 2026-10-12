-- Nexgen OS — core: series and their values.
--
-- Values that change continuously — energy through a meter, temperature in a
-- room, production of a PV system, state of charge of a battery, a setpoint
-- sent to a heat pump — are series of values attached to an object. The
-- shape is the one of OGC SensorThings (Datastream, Observation) and of
-- Brick points: a series says what is observed (an object), which quantity
-- (hence the unit), by what (a sensor), at which step; its values are the
-- timestamped values.
--
-- Measured, simulated and forecast series share the same shape, so a page
-- compares them with one query: a simulated hourly profile is a series of
-- kind `simulated`, usually in a scenario. There is one series store.

create table series (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What is observed: a meter, a device, a building, a site, a participant.
  object_id        uuid not null references objects(id) on delete cascade,
  quantity_code    text not null references quantities(code),
  -- The point that produces the values, when it is described. Null for a
  -- series produced by a computation or read from a data hub.
  sensor_id        uuid references sensors(id) on delete set null,
  name             text,
  -- measured: read from a device or a data hub; simulated: produced by a
  -- model; forecast: about the future; setpoint: a value asked of a device.
  kind             text not null default 'measured',
  -- What one value means (the state classes of Home Assistant, the
  -- accumulation behaviour of Green Button): `interval` covers [at, at +
  -- step) — an energy over a quarter-hour; `instant` is a reading at `at` — a
  -- power, a temperature; `cumulative` is an ever-rising register — a meter
  -- index, whose consumption is the difference between two values.
  value_kind       text not null default 'interval',
  -- Regular step of the series, null when irregular.
  step             interval,
  scenario_id      uuid references scenarios(id) on delete cascade,
  -- Where the values come from: a source of the vocabulary (a grid
  -- operator's hub, a device protocol, a model), and a free note.
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint series_kind check (kind in ('measured', 'simulated', 'forecast', 'setpoint')),
  constraint series_value_kind check (value_kind in ('interval', 'instant', 'cumulative')),
  constraint series_step_positive check (step is null or step > interval '0')
);

comment on table series is
  'One quantity over time for one object — measured, simulated, forecast or asked (OGC SensorThings Datastream, Brick point, Home Assistant state class).';

create index series_object_idx on series (object_id);
create index series_quantity_idx on series (quantity_code);

create trigger series_attach
  before insert or update on series
  for each row execute function attach('object_id');

create table series_values (
  series_id        uuid not null references series(id) on delete cascade,
  at               timestamptz not null,
  -- In the unit of the series' quantity, always.
  value            double precision not null,
  -- measured, estimated, substituted, missing — the quality vocabulary of
  -- metering data exchanges, kept short.
  quality          text not null default 'measured',
  organisation_id  uuid not null references organisations(id) on delete cascade,
  primary key (series_id, at),
  constraint readings_quality check (quality in ('measured', 'estimated', 'substituted', 'missing'))
);

comment on table series_values is
  'Timestamped values of a series, in its quantity''s unit.';

create or replace function series_values_attach()
returns trigger
language plpgsql
as $$
begin
  select organisation_id into new.organisation_id from series where id = new.series_id;
  return new;
end;
$$;

create trigger series_values_attach
  before insert on series_values
  for each row execute function series_values_attach();

-- The one way series are read: resampled on a regular step, combined the
-- way the quantity says (sum, mean or last).
create or replace function resample(
  p_series_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_step      interval
)
returns table (bucket timestamptz, value double precision, samples int)
language sql
stable
as $$
  select date_bin(p_step, r.at, timestamptz '2000-01-01 00:00:00+00') as bucket,
         case
           when s.value_kind = 'cumulative' then (array_agg(r.value order by r.at desc))[1]
           when q.aggregation = 'sum'  then sum(r.value)
           when q.aggregation = 'mean' then avg(r.value)
           else (array_agg(r.value order by r.at desc))[1]
         end as value,
         count(*)::int as samples
    from series_values r
    join series s on s.id = r.series_id
    join quantities q on q.code = s.quantity_code
   where r.series_id = p_series_id
     and r.at >= p_from and r.at < p_to
     and r.quality <> 'missing'
   group by 1, q.aggregation, s.value_kind
   order by 1;
$$;

comment on function resample(uuid, timestamptz, timestamptz, interval) is
  'A series resampled on a regular step, combined by its quantity''s aggregation; a cumulative register gives its last index per step. The one function pages and modules read series through.';

call secure_table('series');
call secure_table('series_values');

grant execute on function resample(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;
