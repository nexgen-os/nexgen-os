-- Nexgen OS — core: measurements and time series.
--
-- Values that change continuously — energy through a meter, temperature in a
-- room, production of an array, state of charge of a battery, a setpoint sent
-- to a heat pump — are series of observations attached to an entity. The
-- shape is the one of OGC SensorThings (Thing, Datastream, Observation) and
-- of Brick points: a datastream says what is observed (an entity), which
-- quantity (hence the unit), by what (a sensor, a meter, a model), at which
-- step; observations are its timestamped values.
--
-- Measured, simulated and forecast series share the same shape, so a page
-- compares them with one query: a simulated hourly profile is a datastream
-- of kind `simulated`, usually in a scenario.

create table datastreams (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  -- What is observed: a building, a storey, a room, an array, a meter.
  entity_id     uuid not null references entities(id) on delete cascade,
  quantity_code text not null references quantities(code),
  -- What produces the values, when it is itself described: a sensor or
  -- meter entity. Null for a series produced by a computation.
  sensor_id     uuid references entities(id) on delete set null,
  name          text,
  -- measured: read from a device or a data hub; simulated: produced by a
  -- model; forecast: about the future; setpoint: a value asked of a device.
  kind          text not null default 'measured',
  -- What one value means (the state classes of Home Assistant, the
  -- accumulation behaviour of Green Button): `interval` covers [at, at +
  -- step) — an energy over a quarter-hour; `instant` is a reading at `at` — a
  -- power, a temperature; `cumulative` is an ever-rising register — a meter
  -- index, whose consumption is the difference between two values.
  value_kind    text not null default 'interval',
  -- Regular step of the series, null when irregular. For a quantity
  -- aggregated by `sum`, an observation covers [at, at + step).
  step          interval,
  scenario_id   uuid references scenarios(id) on delete cascade,
  source        text,
  created_at    timestamptz not null default now(),
  constraint datastreams_kind check (kind in ('measured', 'simulated', 'forecast', 'setpoint')),
  constraint datastreams_value_kind check (value_kind in ('interval', 'instant', 'cumulative')),
  constraint datastreams_step_positive check (step is null or step > interval '0')
);

comment on table datastreams is
  'A series of values of one quantity attached to one entity — measured, simulated, forecast or asked (OGC SensorThings Datastream, Brick point).';

create index datastreams_entity_idx on datastreams (entity_id);
create index datastreams_quantity_idx on datastreams (quantity_code);

create trigger datastreams_attach
  before insert or update on datastreams
  for each row execute function attach_to_entity('entity_id');

create table observations (
  datastream_id uuid not null references datastreams(id) on delete cascade,
  at            timestamptz not null,
  -- In the unit of the datastream's quantity, always.
  value         double precision not null,
  -- measured, estimated, substituted, missing — the quality vocabulary of
  -- metering data exchanges, kept short.
  quality       text not null default 'measured',
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  primary key (datastream_id, at),
  constraint observations_quality check (quality in ('measured', 'estimated', 'substituted', 'missing'))
);

comment on table observations is
  'Timestamped values of a datastream, in its quantity''s unit.';

create or replace function observations_attach()
returns trigger
language plpgsql
as $$
begin
  select workspace_id into new.workspace_id from datastreams where id = new.datastream_id;
  return new;
end;
$$;

create trigger observations_attach
  before insert on observations
  for each row execute function observations_attach();

-- The one way series are read: a datastream resampled on a regular step,
-- combined the way its quantity says (sum, mean or last).
create or replace function series(
  p_datastream_id uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_step          interval
)
returns table (bucket timestamptz, value double precision, samples int)
language sql
stable
as $$
  select date_bin(p_step, o.at, timestamptz '2000-01-01 00:00:00+00') as bucket,
         case
           when d.value_kind = 'cumulative' then (array_agg(o.value order by o.at desc))[1]
           when q.aggregation = 'sum'  then sum(o.value)
           when q.aggregation = 'mean' then avg(o.value)
           else (array_agg(o.value order by o.at desc))[1]
         end as value,
         count(*)::int as samples
    from observations o
    join datastreams d on d.id = o.datastream_id
    join quantities q on q.code = d.quantity_code
   where o.datastream_id = p_datastream_id
     and o.at >= p_from and o.at < p_to
     and o.quality <> 'missing'
   group by 1, q.aggregation, d.value_kind
   order by 1;
$$;

comment on function series(uuid, timestamptz, timestamptz, interval) is
  'A datastream resampled on a regular step, combined by its quantity''s aggregation; a cumulative register gives its last index per step. The one function pages and modules read series through.';

alter table datastreams enable row level security;
alter table observations enable row level security;

create policy datastreams_select on datastreams
  for select to authenticated using (can_read_workspace(workspace_id));
create policy datastreams_write on datastreams
  for all to authenticated
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));
create policy observations_select on observations
  for select to authenticated using (can_read_workspace(workspace_id));
create policy observations_write on observations
  for all to authenticated
  using (can_write_workspace(workspace_id))
  with check (can_write_workspace(workspace_id));

grant select, insert, update, delete on datastreams, observations to authenticated, service_role;
grant execute on function series(uuid, timestamptz, timestamptz, interval) to authenticated, service_role;
