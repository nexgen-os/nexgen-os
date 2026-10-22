-- Nexgen OS — module `storage`: batteries, what their dispatch is computed
-- from, and the estimates computed from them.
--
-- A battery is a device of type `battery`, derived into `storage.devices`
-- with the same id (decision 0042): its usable capacity, its charge and
-- discharge power, its round-trip efficiency, the band of state of charge
-- it is kept in, what it is run for (`storage.objectives`) and the
-- perimeter whose flows it sees — the place of its participant (individual
-- self-consumption) or its project (collective: the surplus and the
-- residual left once the energy is shared). The physics of a battery
-- product is its row of `products` (unit capacity, unit power) and, with
-- the same id, `storage.battery_products` (efficiency, charge and
-- discharge power, cycle life); a column of `storage.devices` overrides
-- the product, and what neither says is the parameter `parameter_of()`
-- resolves for the device (`battery_c_rate`, `round_trip_efficiency`):
-- its own attribute, its participant's, its project's, its organisation's,
-- then its pack's. `storage.battery_of()` is that one resolution, with
-- where each value came from.
--
-- What the module computes is an estimate (`storage.estimates`, decision
-- 0004): a dispatch of a battery over a period, with the series of its
-- charge, discharge and state of charge written by `store()` as
-- `simulated` series of the device, or a sizing of a battery for a
-- participant or a project, with its curve and its recommended point. The
-- rule is in `modules/storage/src/dispatch.ts`, the gestures in
-- `modules/storage/src/estimates.ts`; both are described in plain words in
-- the module's README.

set search_path = nexgen, extensions;

create schema storage;
grant usage on schema storage to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- objectives — what a battery is run for, as a vocabulary.
-- ---------------------------------------------------------------------------

create table storage.objectives (
  code          text primary key,
  name          text not null,
  description   text,
  published_by  text not null default 'storage',
  constraint objectives_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table storage.objectives is
  'What a battery is run for: the rule its dispatch follows. Vocabulary: read by everyone signed in, written by migrations and modules.';

insert into storage.objectives (code, name, description) values
  ('self_consumption', 'Self-consumption',
   'Charge from the surplus of the perimeter, discharge to its residual consumption, as soon as each appears.'),
  ('peak_shaving', 'Peak shaving',
   'Discharge whatever the residual consumption takes above a threshold of power; charge from the surplus, and from the grid while the consumption stays under the threshold.'),
  ('arbitrage', 'Arbitrage',
   'Charge in the cheapest intervals of each local day and discharge to the consumption in the dearest ones, by a price series of the perimeter.');

alter table storage.objectives enable row level security;
create policy storage_objectives_read on storage.objectives for select to authenticated using (true);
grant select on storage.objectives to authenticated;
grant select, insert, update, delete on storage.objectives to service_role;

-- ---------------------------------------------------------------------------
-- The parameters a sizing reads, resolved by parameter_of() (decision
-- 0021). The two a dispatch reads when neither the device nor its product
-- says them, battery_c_rate and round_trip_efficiency, are the core's.
-- ---------------------------------------------------------------------------

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('battery_cost', 'Installed cost of storage',
   'The installed cost of one MWh of usable storage capacity, in the currency of the country per MWh, read by a sizing.',
   'number', 'energy_price', 0, null, '{device,participant,project,organisation}', 'storage'),
  ('battery_lifetime', 'Lifetime of a battery',
   'The years a battery is counted over by a sizing, as a whole number.',
   'integer', null, 1, null, '{device,participant,project,organisation}', 'storage'),
  ('discount_rate', 'Discount rate',
   'The yearly rate future cash flows are discounted at by a net present value, 0 to 1.',
   'number', 'ratio', 0, 1, '{participant,project,organisation}', 'storage');

-- The C-rate and the round-trip efficiency of a representative residential
-- battery are technology figures, the same in every country: this module
-- publishes them at the generic level of parameter_of() (decision 0053),
-- below every place, so that a pack, an organisation or the device itself
-- says otherwise and wins. Read on the page of the Annual Technology
-- Baseline 2025 of the National Laboratory of the Rockies (formerly NREL),
-- "Residential Battery Storage": a representative 5 kW / 12.5 kWh
-- (2.5-hour) system, hence a C-rate of 5 / 12.5 = 0.4, and a round-trip
-- efficiency of 85 %, which the 2025 ATB adopts from Cole et al. (2025).
insert into sources (code, name, description, kind, base_url, docs_url, auth, license, attribution, redistributable, published_by) values
  ('atb_2025_residential_battery', 'Annual Technology Baseline 2025, residential battery storage',
   'The cost and performance of a representative residential lithium-ion battery system (lithium iron phosphate cells) in the Annual Technology Baseline 2025 of the National Laboratory of the Rockies (formerly NREL), a U.S. national laboratory: a technology figure, the same in every country.',
   'text', 'https://atb.nlr.gov/electricity/2025/residential_battery_storage', 'https://atb.nlr.gov/electricity/2025/residential_battery_storage',
   'none', 'Public data of a U.S. federal laboratory, reuse with attribution', 'Annual Technology Baseline 2025, National Laboratory of the Rockies', true, 'storage');

insert into defaults (attribute_type, country, region, condition, value, valid_from, source_code, reference, status, published_by) values
  ('battery_c_rate', null, null, '{}', '0.4', '2025-01-01', 'atb_2025_residential_battery',
   'ATB 2025, Residential Battery Storage, the representative system: 5 kW / 12.5 kWh (2.5-hour), a C-rate of 5 / 12.5 = 0.4', 'default', 'storage'),
  ('round_trip_efficiency', null, null, '{}', '0.85', '2025-01-01', 'atb_2025_residential_battery',
   'ATB 2025, Residential Battery Storage, section Round-Trip Efficiency: 85 %, the representative value of Cole et al. (2025) the 2025 ATB adopts', 'default', 'storage');

-- ---------------------------------------------------------------------------
-- battery_products — the physics of a battery product.
-- ---------------------------------------------------------------------------

create table storage.battery_products (
  id                     uuid primary key references products(id) on delete cascade,
  -- Copied from the product: null for a shared one.
  organisation_id        uuid references organisations(id) on delete cascade,
  -- Per unit of the product; its usable capacity is the product's
  -- `unit_capacity_kwh`, its power the product's `unit_power_kw` unless
  -- the two directions differ.
  charge_power_kw        numeric(12, 3),
  discharge_power_kw     numeric(12, 3),
  round_trip_efficiency  numeric(5, 4),
  -- Full cycles to the end of life the manufacturer states, and the share
  -- of the capacity left then.
  cycle_life             integer,
  end_of_life_capacity   numeric(5, 4),
  -- Where the figures come from: a datasheet, a product database.
  source_code            text references sources(code),
  metadata               jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint battery_products_power check ((charge_power_kw is null or charge_power_kw > 0) and (discharge_power_kw is null or discharge_power_kw > 0)),
  constraint battery_products_efficiency check (round_trip_efficiency is null or (round_trip_efficiency > 0 and round_trip_efficiency <= 1)),
  constraint battery_products_cycle_life check (cycle_life is null or cycle_life > 0),
  constraint battery_products_end_of_life check (end_of_life_capacity is null or (end_of_life_capacity > 0 and end_of_life_capacity <= 1))
);

comment on table storage.battery_products is
  'The physics of a battery product of products, same id: charge and discharge power per unit, round-trip efficiency, cycle life; its usable capacity is the product''s unit_capacity_kwh.';

-- The product exists, is a battery (or a refinement of it), and lends its
-- organisation.
create or replace function storage.battery_products_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  p products%rowtype;
begin
  select * into p from products where id = new.id;
  if not found then
    raise exception 'product_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  if not device_type_is_a(p.device_type, 'battery') then
    raise exception 'product_type_mismatch: % is a %, not a battery', new.id, p.device_type using errcode = 'check_violation';
  end if;
  new.organisation_id := p.organisation_id;
  return new;
end;
$$;

comment on function storage.battery_products_check() is
  'BEFORE INSERT / UPDATE on battery_products: the product exists (product_not_found), is a battery (product_type_mismatch), and lends its organisation.';

create trigger battery_products_check before insert or update on storage.battery_products
  for each row execute function storage.battery_products_check();
create trigger battery_products_set_updated_at before update on storage.battery_products
  for each row execute function set_updated_at();
create index battery_products_organisation_idx on storage.battery_products (organisation_id);

-- As products: a shared product is read by everyone signed in and written
-- by migrations, modules and packs; an organisation's by its members.
alter table storage.battery_products enable row level security;
create policy battery_products_select on storage.battery_products
  for select to authenticated using (organisation_id is null or has_capability('organisation', organisation_id, 'data.read'));
create policy battery_products_write on storage.battery_products
  for all to authenticated
  using (organisation_id is not null and has_capability('organisation', organisation_id, 'data.write'))
  with check (organisation_id is not null and has_capability('organisation', organisation_id, 'data.write'));
grant select, insert, update, delete on storage.battery_products to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- devices — the battery, a device of type battery.
-- ---------------------------------------------------------------------------

create table storage.devices (
  id                     uuid primary key,
  -- Copied from the device by trigger, for row level security.
  organisation_id        uuid not null references organisations(id) on delete cascade,
  -- The energy between an empty and a full battery, for the device as a
  -- whole; null: its product's unit capacity times its unit count.
  usable_capacity_kwh    numeric(12, 3),
  -- The greatest power it charges and discharges at, on its AC side; null:
  -- its product's, its rated power, or its capacity times its C-rate.
  charge_power_kw        numeric(12, 3),
  discharge_power_kw     numeric(12, 3),
  -- The share of the energy charged that comes back; null: its product's,
  -- or the round_trip_efficiency parameter_of() resolves for it.
  round_trip_efficiency  numeric(5, 4),
  -- The band of state of charge it is kept in, in percent of its usable
  -- capacity; null: no band below 100 and above 0.
  min_charge_level       numeric(5, 2),
  max_charge_level       numeric(5, 2),
  objective              text not null default 'self_consumption' references storage.objectives(code),
  -- site: the flows of its participant's place (individual
  -- self-consumption); project: the surplus and residual of its project,
  -- once the energy is shared (collective self-consumption).
  perimeter              text not null default 'site',
  -- For peak shaving: the power the consumption taken from the grid is
  -- kept under.
  peak_threshold_kw      numeric(12, 3),
  metadata               jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint devices_capacity_positive check (usable_capacity_kwh is null or usable_capacity_kwh > 0),
  constraint devices_power_positive check ((charge_power_kw is null or charge_power_kw > 0) and (discharge_power_kw is null or discharge_power_kw > 0)),
  constraint devices_efficiency_range check (round_trip_efficiency is null or (round_trip_efficiency > 0 and round_trip_efficiency <= 1)),
  constraint devices_charge_levels check (
    (min_charge_level is null or min_charge_level between 0 and 100)
    and (max_charge_level is null or max_charge_level between 0 and 100)
    and coalesce(min_charge_level, 0) < coalesce(max_charge_level, 100)
  ),
  constraint devices_perimeter check (perimeter in ('site', 'project')),
  constraint devices_peak_threshold check (peak_threshold_kw is null or peak_threshold_kw >= 0)
);

comment on table storage.devices is
  'A battery: a device of type battery, with its usable capacity, charge and discharge power, round-trip efficiency, band of state of charge, objective and perimeter (its participant''s place or its project). Read with `from devices join storage.devices using (id)`; storage.battery_of() gives each figure with where it came from.';

call derive_devices('storage.devices', 'battery');

create or replace function storage.devices_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from devices where id = new.id);
  return new;
end;
$$;

create trigger devices_organisation before insert or update of id on storage.devices
  for each row execute function storage.devices_organisation();
create trigger devices_set_updated_at before update on storage.devices
  for each row execute function set_updated_at();
create index devices_organisation_idx on storage.devices (organisation_id);
call secure_table('storage.devices');

-- ---------------------------------------------------------------------------
-- battery_of — the figures a dispatch reads, and where each came from.
-- ---------------------------------------------------------------------------

-- A parameter_of() that answers null where nobody decided the value,
-- instead of refusing: the caller decides whether it needs it.
create or replace function storage.parameter_or_null(p_kind text, p_id uuid, p_attribute_type text, p_at timestamptz)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
begin
  return parameter_of(p_kind, p_id, p_attribute_type, p_at);
exception when no_data_found then
  return null;
end;
$$;

comment on function storage.parameter_or_null(text, uuid, text, timestamptz) is
  'parameter_of(), null where the value is missing or not decided (parameter_missing, parameter_not_decided); parameter_ambiguous still raises.';

create or replace function storage.battery_of(p_device_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
declare
  d        devices%rowtype;
  s        storage.devices%rowtype;
  p        products%rowtype;
  bp       storage.battery_products%rowtype;
  capacity jsonb;
  c_rate   jsonb;
  eff      jsonb;
  charge   jsonb;
  dis      jsonb;
begin
  select * into d from devices where id = p_device_id;
  if not found then
    raise exception 'device_not_found: %', p_device_id using errcode = 'no_data_found';
  end if;
  select * into s from storage.devices where id = p_device_id;
  if not found then
    raise exception 'battery_not_described: % has no row in storage.devices', p_device_id using errcode = 'no_data_found';
  end if;
  select * into p from products where id = d.product_id;
  select * into bp from storage.battery_products where id = d.product_id;

  capacity := case
    when s.usable_capacity_kwh is not null then jsonb_build_object('value', s.usable_capacity_kwh, 'level', 'device')
    when p.unit_capacity_kwh is not null then jsonb_build_object('value', p.unit_capacity_kwh * d.unit_count, 'level', 'product', 'product_id', p.id)
  end;
  if capacity is null then
    raise exception 'capacity_required: battery % has no usable capacity, nor a product that gives one', p_device_id using errcode = 'not_null_violation';
  end if;

  -- The power of each direction: the device's own, its product's for that
  -- direction, its rated power, its product's unit power, then its
  -- capacity times its C-rate.
  if coalesce(s.charge_power_kw, bp.charge_power_kw, d.rated_power_kw, p.unit_power_kw) is null
     or coalesce(s.discharge_power_kw, bp.discharge_power_kw, d.rated_power_kw, p.unit_power_kw) is null then
    c_rate := parameter_of('device', p_device_id, 'battery_c_rate', p_at);
  end if;
  charge := case
    when s.charge_power_kw is not null then jsonb_build_object('value', s.charge_power_kw, 'level', 'device')
    when bp.charge_power_kw is not null then jsonb_build_object('value', bp.charge_power_kw * d.unit_count, 'level', 'product', 'product_id', p.id)
    when d.rated_power_kw is not null then jsonb_build_object('value', d.rated_power_kw, 'level', 'rated_power')
    when p.unit_power_kw is not null then jsonb_build_object('value', p.unit_power_kw * d.unit_count, 'level', 'product', 'product_id', p.id)
    else jsonb_build_object('value', (capacity->>'value')::numeric * (c_rate->>'value')::numeric, 'level', 'c_rate', 'c_rate', c_rate)
  end;
  dis := case
    when s.discharge_power_kw is not null then jsonb_build_object('value', s.discharge_power_kw, 'level', 'device')
    when bp.discharge_power_kw is not null then jsonb_build_object('value', bp.discharge_power_kw * d.unit_count, 'level', 'product', 'product_id', p.id)
    when d.rated_power_kw is not null then jsonb_build_object('value', d.rated_power_kw, 'level', 'rated_power')
    when p.unit_power_kw is not null then jsonb_build_object('value', p.unit_power_kw * d.unit_count, 'level', 'product', 'product_id', p.id)
    else jsonb_build_object('value', (capacity->>'value')::numeric * (c_rate->>'value')::numeric, 'level', 'c_rate', 'c_rate', c_rate)
  end;

  eff := case
    when s.round_trip_efficiency is not null then jsonb_build_object('value', s.round_trip_efficiency, 'level', 'device')
    when bp.round_trip_efficiency is not null then jsonb_build_object('value', bp.round_trip_efficiency, 'level', 'product', 'product_id', p.id)
    else parameter_of('device', p_device_id, 'round_trip_efficiency', p_at)
  end;

  return jsonb_build_object(
    'device_id', p_device_id,
    'participant_id', d.participant_id,
    'usable_capacity_kwh', capacity,
    'charge_power_kw', charge,
    'discharge_power_kw', dis,
    'round_trip_efficiency', eff,
    'min_charge_level', coalesce(s.min_charge_level, 0),
    'max_charge_level', coalesce(s.max_charge_level, 100),
    'objective', s.objective,
    'perimeter', s.perimeter,
    'peak_threshold_kw', s.peak_threshold_kw,
    'cycle_life', bp.cycle_life
  );
end;
$$;

comment on function storage.battery_of(uuid, timestamptz) is
  'The figures a dispatch of a battery reads at a moment, each {value, level} with where it came from: usable capacity (the device, else its product times its unit count; capacity_required), charge and discharge power (the device, its battery product, its rated power, its product''s unit power, else capacity times the battery_c_rate parameter_of() resolves), round-trip efficiency (the device, its battery product, else parameter_of()), the band of state of charge in percent, the objective, the perimeter, the peak threshold, the cycle life. Refuses device_not_found, battery_not_described, capacity_required, and what parameter_of() refuses.';

grant execute on function storage.parameter_or_null(text, uuid, text, timestamptz) to authenticated, service_role;
grant execute on function storage.battery_of(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- estimates — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table storage.estimates (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from its subject by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Its subject, one of the three: a dispatch is about the battery it ran,
  -- a sizing about the participant or the project the battery is sized for.
  device_id        uuid references devices(id) on delete cascade,
  participant_id   uuid references participants(id) on delete cascade,
  project_id       uuid references projects(id) on delete cascade,
  -- For a sizing, the criterion its recommended point optimises, a word of
  -- the core's vocabulary; null for a dispatch.
  criterion        text references sizing_criteria(code),
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  -- What it read: the period, the step, the series and the batteries,
  -- each parameter with where it came from, the prices.
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint estimates_one_subject check (num_nonnulls(device_id, participant_id, project_id) = 1),
  constraint estimates_criterion_subject check (criterion is null or device_id is null)
);

comment on table storage.estimates is
  'What the module computed: the dispatch of a battery over a period (about the device; its charge, discharge and state of charge are simulated series of the device naming the estimate in their source) or the sizing of a battery for a participant or a project (about the participant or the project, its criterion, its curve and recommended point). Its inputs, its provenance (the program and version), its results. A new computation adds an estimate.';

create index estimates_device_idx on storage.estimates (device_id);
create index estimates_participant_idx on storage.estimates (participant_id);
create index estimates_project_idx on storage.estimates (project_id);

create or replace function storage.estimates_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := case
    when new.device_id is not null then object_organisation('device', new.device_id)
    when new.participant_id is not null then object_organisation('participant', new.participant_id)
    else object_organisation('project', new.project_id)
  end;
  return new;
end;
$$;

comment on function storage.estimates_organisation() is
  'BEFORE INSERT / UPDATE on estimates: copies the organisation of its subject.';

create trigger estimates_organisation before insert or update of device_id, participant_id, project_id on storage.estimates
  for each row execute function storage.estimates_organisation();
create trigger estimates_set_updated_at before update on storage.estimates
  for each row execute function set_updated_at();
call secure_table('storage.estimates', null, 'coalesce(participant_id, participant_of(''device'', device_id))');

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('storage', 'Storage', '0.3.0', 'storage', '0.3.0',
        'Batteries and their product physics, their dispatch on the interval series of a participant''s place or of a project''s sharing, and the sizing of a battery, as estimates.');
