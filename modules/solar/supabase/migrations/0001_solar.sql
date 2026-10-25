-- Nexgen OS — module `solar`: photovoltaic systems and what a yield is
-- computed from.
--
-- Decision 0012. A PV system is a device of type `solar`, derived into
-- `solar.devices` with the same id. It is made of arrays: one group of
-- modules with one orientation each (pvlib's Array, PVsyst's orientation,
-- OpenSolar's module group, Orange Button's PVArray). The physics of a
-- module or an inverter product is attached to its row of the core
-- `products`, in pvlib's parameter names. An array carries its own
-- azimuth and tilt, and nothing else of where it is: the system belongs to
-- a participant, whose point the yield reads (decision 0043). A far
-- horizon belongs to a participant's place or to a PV system. A yield
-- profile is a named set of modelling choices with an ordered list of
-- losses, so that an estimate says what it was computed with.
--
-- A design variant of a participant's PV — another array, another tilt —
-- is a row of this module (`solar.variants`): the arrays and the
-- horizons of a variant exist only in it, and a yield computed in it says
-- so in its inputs. What the module computes is an estimate
-- (`solar.estimates`, decision 0004): its inputs, its engine and its
-- results, and the series it wrote.
--
-- Conventions, everywhere in this schema: azimuth in degrees clockwise from
-- true north (180 = facing south), tilt in degrees from horizontal (0 =
-- flat). Every reader converts from the convention of its tool on the way
-- in. Engines (pvlib, PVGIS, SAM) run outside Postgres; their results come
-- back as rows of `solar.estimates`, each written by the module's function
-- that computed it.

set search_path = nexgen, extensions;

create schema solar;
grant usage on schema solar to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- devices — the PV system, a device of type solar.
-- ---------------------------------------------------------------------------

create table solar.devices (
  id                        uuid primary key,
  -- Copied from the device by trigger, for row level security.
  organisation_id           uuid not null references organisations(id) on delete cascade,
  -- Peak DC power at standard test conditions, and the AC power the
  -- inverters may deliver. When the system has arrays, its DC power is the
  -- sum of theirs (`solar.system_kwp`).
  kwp_dc                    numeric(12, 3),
  kva_ac                    numeric(12, 3),
  -- injection: everything produced goes to the grid; self_consumption: the
  -- participant uses what it can and injects the rest; off_grid: no connection.
  grid_connection           text,
  commissioned_on           date,
  -- Yearly loss of output from ageing, and the loss of the first months
  -- (light-induced degradation), in percent.
  degradation_pct_per_year  numeric(5, 3),
  first_year_loss_pct       numeric(5, 3),
  metadata                  jsonb not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint devices_kwp_positive check (kwp_dc is null or kwp_dc >= 0),
  constraint devices_kva_positive check (kva_ac is null or kva_ac >= 0),
  constraint devices_grid_connection check (grid_connection is null or grid_connection in ('injection', 'self_consumption', 'off_grid')),
  constraint devices_degradation_range check (degradation_pct_per_year is null or degradation_pct_per_year between 0 and 5),
  constraint devices_first_year_loss_range check (first_year_loss_pct is null or first_year_loss_pct between 0 and 20)
);

comment on table solar.devices is
  'A PV system: a device of type solar, with its DC and AC power, grid connection, commissioning date and degradation (Orange Button PVSystem). Read with `from devices join solar.devices using (id)`.';

call derive_devices('solar.devices', 'solar');

create or replace function solar.devices_organisation()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from devices where id = new.id);
  return new;
end;
$$;

create trigger devices_organisation before insert or update of id on solar.devices
  for each row execute function solar.devices_organisation();
create trigger devices_set_updated_at before update on solar.devices
  for each row execute function set_updated_at();
create index devices_organisation_idx on solar.devices (organisation_id);
call secure_table('solar.devices');

-- ---------------------------------------------------------------------------
-- module_products, inverter_products — the physics of a product.
-- ---------------------------------------------------------------------------
--
-- The identity of a product (manufacturer, model, unit power, datasheet,
-- price) is its row of `products`; these tables add, with the same
-- id, the model family and its parameters as one JSON object in pvlib's key
-- names. pvlib infers its model from these keys, so a stored set describes
-- itself; the keys pvlib infers from are required here.
--
-- Module models and their keys (pvlib 0.16.1, research note §1.4 and §4):
--   pvwatts  pdc0 (W at STC), gamma_pdc (1/°C, negative)           required: both
--   cec      a_ref, I_L_ref, I_o_ref, R_sh_ref, R_s, Adjust,
--            alpha_sc, cells_in_series                               required: the first six
--   pvsyst   gamma_ref, mu_gamma, I_L_ref, I_o_ref, R_sh_ref, R_sh_0,
--            R_sh_exp, R_s, alpha_sc, cells_in_series, EgRef        required: gamma_ref, mu_gamma, R_sh_0, R_sh_exp
--   sapm     A0…A4, B0…B5, C0…C7, Isco, Impo, Voco, Vmpo, …          required: A0, A1, C3
-- Inverter models and their keys:
--   pvwatts  pdc0 (W DC input at nominal), eta_inv_nom (0–1)        required: both
--   sandia   Paco, Pdco, Vdco, Pso, C0, C1, C2, C3, Pnt              required: C0, C1, C2
--   adr      ADRCoefficients, Pnom, Vnom, Vmin, Vmax, Pnt, …         required: ADRCoefficients
--   ond      the parameters of a PVsyst OND file as read by pvlib's
--            read_panond (PNomAC, PMaxAC, efficiency curves…)       required: none
-- The PAN or OND file itself is kept as a document of the product's
-- source; it is read, never written.

create table solar.module_products (
  id               uuid primary key references products(id) on delete cascade,
  -- Copied from the product by trigger: null for a shared product.
  organisation_id  uuid references organisations(id) on delete cascade,
  model            text not null,
  parameters       jsonb not null,
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint module_products_model check (model in ('pvsyst', 'cec', 'sapm', 'pvwatts')),
  constraint module_products_parameters_object check (jsonb_typeof(parameters) = 'object'),
  constraint module_products_pvwatts_keys check (model <> 'pvwatts' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['pdc0', 'gamma_pdc']),
  constraint module_products_cec_keys check (model <> 'cec' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['a_ref', 'I_L_ref', 'I_o_ref', 'R_sh_ref', 'R_s', 'Adjust']),
  constraint module_products_pvsyst_keys check (model <> 'pvsyst' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['gamma_ref', 'mu_gamma', 'R_sh_0', 'R_sh_exp']),
  constraint module_products_sapm_keys check (model <> 'sapm' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['A0', 'A1', 'C3'])
);

comment on table solar.module_products is
  'The physics of a PV module product of products, same id: a model family (pvsyst, cec, sapm, pvwatts) and its parameters in pvlib''s key names.';

create table solar.inverter_products (
  id               uuid primary key references products(id) on delete cascade,
  organisation_id  uuid references organisations(id) on delete cascade,
  model            text not null,
  parameters       jsonb not null,
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint inverter_products_model check (model in ('sandia', 'adr', 'pvwatts', 'ond')),
  constraint inverter_products_parameters_object check (jsonb_typeof(parameters) = 'object'),
  constraint inverter_products_pvwatts_keys check (model <> 'pvwatts' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['pdc0', 'eta_inv_nom']),
  constraint inverter_products_sandia_keys check (model <> 'sandia' or jsonb_typeof(parameters) <> 'object' or parameters ?& array['C0', 'C1', 'C2']),
  constraint inverter_products_adr_keys check (model <> 'adr' or jsonb_typeof(parameters) <> 'object' or parameters ? 'ADRCoefficients')
);

comment on table solar.inverter_products is
  'The physics of an inverter product of products, same id: a model family (sandia, adr, pvwatts, ond) and its parameters in pvlib''s key names.';

-- BEFORE INSERT / UPDATE: the product exists, is of the device type named
-- by tg_argv[0] (or a refinement of it), and lends its organisation.
create or replace function solar.product_check()
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
  if not device_type_is_a(p.device_type, tg_argv[0]) then
    raise exception 'product_type_mismatch: % is a %, not a %', new.id, p.device_type, tg_argv[0]
      using errcode = 'check_violation';
  end if;
  new.organisation_id := p.organisation_id;
  return new;
end;
$$;

create trigger module_products_check before insert or update on solar.module_products
  for each row execute function solar.product_check('solar');
create trigger inverter_products_check before insert or update on solar.inverter_products
  for each row execute function solar.product_check('inverter');
create trigger module_products_set_updated_at before update on solar.module_products
  for each row execute function set_updated_at();
create trigger inverter_products_set_updated_at before update on solar.inverter_products
  for each row execute function set_updated_at();

-- Row level security as for products: shared products (no
-- organisation) are read by everyone signed in and written by migrations,
-- modules and packs; an organisation's products by its members.
do $$
declare
  t text;
begin
  foreach t in array array['module_products', 'inverter_products'] loop
    execute format('create index %I on solar.%I (organisation_id)', t || '_organisation_idx', t);
    execute format('alter table solar.%I enable row level security', t);
    execute format('create policy %I on solar.%I for select to authenticated using (organisation_id is null or has_capability(''organisation'', organisation_id, ''data.read''))',
                   t || '_select', t);
    execute format('create policy %I on solar.%I for all to authenticated
                      using (organisation_id is not null and has_capability(''organisation'', organisation_id, ''data.write''))
                      with check (organisation_id is not null and has_capability(''organisation'', organisation_id, ''data.write''))',
                   t || '_write', t);
    execute format('grant select, insert, update, delete on solar.%I to authenticated, service_role', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- variants — the variants of a participant's PV design.
-- ---------------------------------------------------------------------------

create table solar.variants (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The participant whose PV the variant redesigns.
  participant_id   uuid not null references participants(id) on delete cascade,
  -- A variant may build on another one (variant B of the extension).
  parent_id        uuid references solar.variants(id) on delete restrict,
  name             text not null,
  description      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint variants_name_not_blank check (btrim(name) <> ''),
  constraint variants_not_own_parent check (parent_id is distinct from id)
);

comment on table solar.variants is
  'A design variant of the PV of a participant: arrays and horizons with a variant exist only in it (and in the variants built on it), those without one exist in reality.';

create index variants_participant_idx on solar.variants (participant_id);
create index variants_organisation_idx on solar.variants (organisation_id);
create trigger variants_participant_id_check before insert or update of participant_id on solar.variants
  for each row execute function parent_check('participant_id', 'participants');
create trigger variants_parent_id_check before insert or update of parent_id on solar.variants
  for each row execute function parent_check('parent_id', 'solar.variants');
create trigger variants_set_updated_at before update on solar.variants
  for each row execute function set_updated_at();
call secure_table('solar.variants');

-- A variant and the variants it builds on, nearest first.
create or replace function solar.variant_chain(p_variant_id uuid)
returns table (variant_id uuid, rank integer)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id, 1 as rank from solar.variants s where s.id = p_variant_id
    union all
    select s.id, s.parent_id, chain.rank + 1 from solar.variants s join chain on s.id = chain.parent_id
  )
  select id, rank from chain;
$$;

comment on function solar.variant_chain(uuid) is
  'A variant and the variants it builds on, nearest first; nothing for reality (null).';

create or replace function solar.create_variant(p_participant_id uuid, p_name text, p_parent_id uuid default null, p_description text default null)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id  uuid := gen_random_uuid();
  p     participants%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  if p_parent_id is not null and not exists (select 1 from solar.variants where id = p_parent_id and participant_id = p_participant_id) then
    raise exception 'variant_not_found: %', p_parent_id using errcode = 'no_data_found';
  end if;
  insert into solar.variants (id, organisation_id, participant_id, parent_id, name, description)
  values (v_id, p.organisation_id, p_participant_id, p_parent_id, p_name, p_description);
  return v_id;
end;
$$;

comment on function solar.create_variant(uuid, text, uuid, text) is
  'Creates a design variant of the PV of a participant, on top of another of its variants when a parent is given. Refuses participant_not_found, variant_not_found. Returns its id.';

-- ---------------------------------------------------------------------------
-- estimates — what the module computed (decision 0004).
-- ---------------------------------------------------------------------------

create table solar.estimates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- What it is about, exactly one: the PV system a yield, a performance or
  -- an exceedance is of; the participant a potential or a sizing is for,
  -- before any system exists (its roof, its consumption).
  device_id        uuid references devices(id) on delete cascade,
  participant_id   uuid references participants(id) on delete cascade,
  -- The kind of figure: yield, performance, exceedance, potential, sizing.
  kind             text not null default 'yield',
  -- Where it comes from: the program and the version that computed it.
  provenance       text not null,
  -- What it read: the weather, the period, the profile, the variant, the
  -- arrays, the parameters and the level each came from.
  inputs           jsonb not null,
  results          jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint estimates_one_subject check (num_nonnulls(device_id, participant_id) = 1),
  constraint estimates_kind check (kind in ('yield', 'performance', 'exceedance', 'potential', 'sizing')),
  constraint estimates_kind_of_subject check ((kind in ('potential', 'sizing')) = (participant_id is not null))
);

comment on table solar.estimates is
  'The figures the module computed: the yields, performance indicators and exceedances of a PV system, the potential and the sizing of the PV of a participant before any system exists; its kind, its inputs, its provenance (the program and version that computed it), its results; the series an estimate wrote name it in their source. A new computation adds an estimate or replaces one.';

create index estimates_device_idx on solar.estimates (device_id);
create index estimates_participant_idx on solar.estimates (participant_id);

create or replace function solar.estimates_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := case when new.device_id is not null then object_organisation('device', new.device_id)
                              else object_organisation('participant', new.participant_id) end;
  return new;
end;
$$;

comment on function solar.estimates_check() is
  'BEFORE INSERT / UPDATE on solar.estimates: copies the organisation of its device or its participant (object_not_found).';

create trigger estimates_check before insert or update of device_id, participant_id, organisation_id on solar.estimates
  for each row execute function solar.estimates_check();
create trigger estimates_set_updated_at before update on solar.estimates
  for each row execute function set_updated_at();
call secure_table('solar.estimates', 'project_of(case when device_id is not null then ''device'' else ''participant'' end, coalesce(device_id, participant_id))',
  'coalesce(participant_id, participant_of(''device'', device_id))');
-- ---------------------------------------------------------------------------
-- curve_series — the production of a participant, measured first.
-- ---------------------------------------------------------------------------

-- For each PV system of a participant, the series its production is read
-- from over a period: a measured `production_energy` of the system before a
-- yield this module estimated for it (a simulated series naming its
-- estimate), then the latest; only series holding values in the period.
-- Production is a device's: a meter's injection is net of what was consumed
-- on the spot and is never read as production. Reads under the caller's row
-- level security. The model of consumption.curve_series().
create or replace function solar.curve_series(p_participant_id uuid, p_from timestamptz, p_to timestamptz)
returns table (device_id uuid, series_id uuid, kind text)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select distinct on (d.id) d.id, se.id, se.kind
    from devices d
    join series se on se.object_kind = 'device' and se.object_id = d.id and se.quantity_code = 'production_energy'
    left join solar.estimates e on se.source = 'solar.estimates:' || e.id
   where d.participant_id = p_participant_id and device_type_is_a(d.device_type, 'solar')
     and (se.kind = 'measured' or (se.kind = 'simulated' and e.id is not null))
     and exists (select 1 from series_values v where v.series_id = se.id and v.at >= p_from and v.at < p_to and v.quality <> 3)
   order by d.id, se.kind = 'measured' desc, e.updated_at desc nulls last, se.created_at desc;
$$;

comment on function solar.curve_series(uuid, timestamptz, timestamptz) is
  'For each PV system of a participant, the series its production is read from over a period: measured first, otherwise the latest yield this module estimated for it holding values in the period. Production is a device''s, never a meter''s injection.';

-- The production of a participant over a period, on a step: the sum of its
-- PV systems, each read measured first; with the series read and whether
-- each was measured.
create or replace function solar.curve(p_participant_id uuid, p_from timestamptz, p_to timestamptz, p_step interval)
returns table (bucket timestamptz, value double precision, series jsonb)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with chosen as (select * from solar.curve_series(p_participant_id, p_from, p_to))
  select r.bucket, sum(r.value), jsonb_object_agg(c.series_id, c.kind)
    from chosen c
    cross join lateral resample(c.series_id, p_from, p_to, p_step) r
   group by r.bucket
   order by r.bucket;
$$;

comment on function solar.curve(uuid, timestamptz, timestamptz, interval) is
  'The production of a participant over a period on a step, the sum of its PV systems read measured first, with the series read and their kind.';

grant execute on function solar.curve_series(uuid, timestamptz, timestamptz), solar.curve(uuid, timestamptz, timestamptz, interval)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pv_arrays — one group of modules with one orientation.
-- ---------------------------------------------------------------------------

create table solar.pv_arrays (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references organisations(id) on delete cascade,
  device_id         uuid not null references solar.devices(id) on delete cascade,
  name                 text not null,
  -- Its own, always: tilted frames on a flat roof differ from the roof. The
  -- `building` module fills them from the surface it places the array on when
  -- they are not given. For a tracker: its axis, or null.
  azimuth_deg          numeric(6, 2),
  tilt_deg             numeric(5, 2),
  -- How the back of the modules is ventilated, which sets their temperature:
  -- open_rack (free-standing), roof_parallel (on a pitched roof, ventilated),
  -- semi_integrated, insulated (integrated, no ventilation), floating,
  -- tracker.
  mounting             text,
  module_product_id    uuid references products(id) on delete set null,
  module_count         integer,
  modules_per_string   integer,
  strings              integer,
  inverter_product_id  uuid references products(id) on delete set null,
  inverter_count       integer,
  -- Ground reflectance seen by the array, 0 to 1.
  albedo               numeric(4, 3),
  bifacial             boolean not null default false,
  -- Peak DC power. Computed from the module product's unit power and the
  -- module count when not given.
  kwp_dc               numeric(12, 3),
  -- The fraction of the light dirt takes from this array over a year,
  -- when the place says it for the array itself (`solar.soiling_of()`).
  soiling_loss         numeric(5, 4),
  metadata             jsonb not null default '{}',
  variant_id          uuid references solar.variants(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint pv_arrays_name_not_blank check (btrim(name) <> ''),
  constraint pv_arrays_azimuth_range check (azimuth_deg is null or (azimuth_deg >= 0 and azimuth_deg < 360)),
  constraint pv_arrays_tilt_range check (tilt_deg is null or (tilt_deg >= 0 and tilt_deg <= 180)),
  constraint pv_arrays_mounting check (mounting is null or mounting in ('open_rack', 'roof_parallel', 'semi_integrated', 'insulated', 'floating', 'tracker')),
  constraint pv_arrays_counts_positive check (
    (module_count is null or module_count > 0) and (modules_per_string is null or modules_per_string > 0)
    and (strings is null or strings > 0) and (inverter_count is null or inverter_count > 0)),
  constraint pv_arrays_strings_add_up check (
    module_count is null or modules_per_string is null or strings is null or module_count = modules_per_string * strings),
  constraint pv_arrays_albedo_range check (albedo is null or (albedo >= 0 and albedo <= 1)),
  constraint pv_arrays_kwp_positive check (kwp_dc is null or kwp_dc >= 0),
  constraint pv_arrays_soiling_range check (soiling_loss is null or (soiling_loss >= 0 and soiling_loss <= 1))
);

comment on table solar.pv_arrays is
  'A group of modules with one orientation in a PV system: azimuth and tilt, mounting, module and inverter products and counts, string layout, albedo (pvlib Array, PVsyst orientation, OpenSolar module group, Orange Button PVArray).';

create index pv_arrays_system_idx on solar.pv_arrays (device_id);

-- BEFORE INSERT / UPDATE: DC power comes from the module product when it
-- is not given.
create or replace function solar.pv_arrays_fill()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.kwp_dc is null and new.module_count is not null and new.module_product_id is not null then
    new.kwp_dc := (select unit_power_kw * new.module_count from products where id = new.module_product_id);
  end if;
  return new;
end;
$$;

create trigger pv_arrays_fill before insert or update on solar.pv_arrays
  for each row execute function solar.pv_arrays_fill();
-- The system of an array is a device of the core: the parent check reads
-- its organisation there.
create trigger pv_arrays_device_id_check before insert or update of device_id on solar.pv_arrays
  for each row execute function parent_check('device_id', 'devices');
create trigger pv_arrays_variant_id_check before insert or update of variant_id on solar.pv_arrays
  for each row execute function parent_check('variant_id', 'solar.variants');
create trigger pv_arrays_set_updated_at before update on solar.pv_arrays
  for each row execute function set_updated_at();
create index pv_arrays_organisation_idx on solar.pv_arrays (organisation_id);
call secure_table('solar.pv_arrays');

-- DC power of a system: the sum of its arrays, or its own figure when it
-- has none. In a variant, the arrays of reality and of the variant and
-- the variants it builds on.
create or replace function solar.system_kwp(p_device_id uuid, p_variant_id uuid default null)
returns numeric
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select coalesce(
    (select sum(a.kwp_dc) from solar.pv_arrays a
      where a.device_id = p_device_id
        and (a.variant_id is null or a.variant_id in (select variant_id from solar.variant_chain(p_variant_id)))),
    (select kwp_dc from solar.devices where id = p_device_id)
  );
$$;

comment on function solar.system_kwp(uuid, uuid) is
  'Peak DC power of a PV system in kWp: the sum of its arrays, or the system''s own kwp_dc when it has no array.';

-- ---------------------------------------------------------------------------
-- horizons — the far horizon of a participant's place or of a PV system.
-- ---------------------------------------------------------------------------

-- A profile is a non-empty array of [azimuth_deg, elevation_deg] pairs:
-- azimuth clockwise from true north in [0, 360), elevation of the horizon
-- above the horizontal in [-90, 90].
create or replace function solar.horizon_profile_valid(p_profile jsonb)
returns boolean
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select case
    when jsonb_typeof(p_profile) <> 'array' then false
    else not exists (
      select 1 from jsonb_array_elements(p_profile) p
       where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
          or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number'
          or (p ->> 0)::numeric < 0 or (p ->> 0)::numeric >= 360
          or (p ->> 1)::numeric < -90 or (p ->> 1)::numeric > 90
    )
  end;
$$;

create table solar.horizons (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from the object by trigger (`attach`).
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- A participant (its place) or a PV system (a device), by its kind and its id.
  object_kind      text not null,
  object_id        uuid not null,
  profile          jsonb not null,
  -- Where it comes from: PVGIS's elevation model, a survey, a PVsyst or
  -- Meteonorm file.
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  variant_id      uuid references solar.variants(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint horizons_object_kind check (object_kind in ('participant', 'device')),
  constraint horizons_profile_not_empty check (case when jsonb_typeof(profile) = 'array' then jsonb_array_length(profile) > 0 else false end),
  constraint horizons_profile_pairs check (solar.horizon_profile_valid(profile))
);

comment on table solar.horizons is
  'The far horizon of a participant''s place or of a PV system: [azimuth_deg, elevation_deg] pairs, azimuth clockwise from true north. One per object and variant; every yield estimate on it reads it.';

create unique index horizons_one_per_object on solar.horizons (object_kind, object_id, variant_id) nulls not distinct;

create trigger horizons_attach before insert or update on solar.horizons
  for each row execute function attach();
create trigger horizons_set_updated_at before update on solar.horizons
  for each row execute function set_updated_at();
create index horizons_organisation_idx on solar.horizons (organisation_id);
call secure_table('solar.horizons');

-- ---------------------------------------------------------------------------
-- yield_profiles — a named set of modelling choices.
-- ---------------------------------------------------------------------------
--
-- Model names follow pvlib where pvlib has the model (`haydavies`, `perez`,
-- `isotropic`, `erbs`, `dirint`, `faiman`, `pvsyst`, `sapm`, `physical`,
-- `ashrae`, `martin_ruiz`), and name the tool otherwise (`muneer`,
-- `hofmann`, `delta_t`). Null means the profile does not fix the choice.
--
-- `losses` is an ordered array of {"code": ..., "pct": ...}. Each
-- percentage applies to the energy left after the previous ones, so they
-- multiply, in the order given (PVsyst's loss diagram). A null `pct` means
-- the profile does not fix it: a model computes it (`iam`) or the estimate
-- supplies it. A negative percentage is a gain.

create or replace function solar.losses_valid(p_losses jsonb)
returns boolean
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select case
    when jsonb_typeof(p_losses) <> 'array' then false
    else not exists (
      select 1 from jsonb_array_elements(p_losses) l
       where jsonb_typeof(l) <> 'object'
          or jsonb_typeof(l -> 'code') is distinct from 'string'
          or (l ->> 'code') !~ '^[a-z][a-z0-9_]*$'
          or coalesce(jsonb_typeof(l -> 'pct'), 'null') not in ('number', 'null')
          or (jsonb_typeof(l -> 'pct') = 'number' and ((l ->> 'pct')::numeric <= -100 or (l ->> 'pct')::numeric >= 100))
    )
  end;
$$;

create table solar.yield_profiles (
  code                 text primary key,
  name                 text not null,
  -- From global horizontal to direct and diffuse; `none` when the weather
  -- source gives the components.
  decomposition_model  text,
  -- From direct and diffuse to the plane of the array.
  transposition_model  text,
  -- Reflection losses at the module's glass (incidence angle modifier).
  iam_model            text,
  temperature_model    text,
  -- The temperature model's parameters, in pvlib's names where it has them
  -- (faiman: u0, u1; pvsyst: u_c, u_v).
  temperature_params   jsonb not null default '{}',
  spectral_model       text,
  losses               jsonb not null default '[]',
  -- Whether DC power above the inverter's AC limit is cut.
  clipping             boolean not null default true,
  description          text,
  published_by         text not null,
  constraint yield_profiles_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint yield_profiles_model_names check (
    coalesce(decomposition_model, 'x') ~ '^[a-z][a-z0-9_]*$' and coalesce(transposition_model, 'x') ~ '^[a-z][a-z0-9_]*$'
    and coalesce(iam_model, 'x') ~ '^[a-z][a-z0-9_]*$' and coalesce(temperature_model, 'x') ~ '^[a-z][a-z0-9_]*$'
    and coalesce(spectral_model, 'x') ~ '^[a-z][a-z0-9_]*$'),
  constraint yield_profiles_temperature_params_object check (jsonb_typeof(temperature_params) = 'object'),
  constraint yield_profiles_losses_ordered_list check (solar.losses_valid(losses))
);

comment on table solar.yield_profiles is
  'A named set of modelling choices for a PV yield: decomposition, transposition, incidence, temperature, spectral, an ordered list of losses, clipping. A yield estimate names the one it used.';

-- A vocabulary: read by everyone signed in, written by migrations, modules
-- and packs.
alter table solar.yield_profiles enable row level security;
create policy yield_profiles_read on solar.yield_profiles for select to authenticated using (true);
grant select on solar.yield_profiles to authenticated;
grant select, insert, update, delete on solar.yield_profiles to service_role;

insert into solar.yield_profiles
  (code, name, decomposition_model, transposition_model, iam_model, temperature_model, temperature_params, spectral_model, losses, clipping, published_by, description)
values
  ('pvgis_like', 'Like PVGIS PVcalc', 'none', 'muneer', null, 'faiman', '{"u0": 26.9, "u1": 6.2}', null,
   '[{"code": "system", "pct": 14}]', false, 'solar',
   'What PVGIS PVcalc does; PVGIS itself runs it. Published by PVGIS: hourly irradiance from SARAH (or ERA5 outside its coverage), which gives the direct and diffuse components (no decomposition); '
   'Muneer transposition; the horizon PVGIS computes from its ~90 m elevation model (keep it in solar.horizons with its source); '
   'Faiman cell temperature with U0 26.9 and U1 6.2; one aggregate system loss, 14 % by default; no inverter model, so no clipping. '
   'Not verified: the incidence and spectral models PVGIS applies, left null.'),
  ('pvwatts', 'PVWatts', null, null, null, 'faiman', '{"u0": 25, "u1": 6.84}', null,
   '[{"code": "system", "pct": 14}]', false, 'solar',
   'The quick estimate of PVWatts, as this engine runs it: plane-of-array irradiance transposed by the weather source (Open-Meteo''s global_tilted_irradiance; no decomposition or transposition model of its own, both left null); '
   'Faiman cell temperature with pvlib''s defaults U0 25 and U1 6.84 (a published default); the PVWatts DC model (gamma_pdc of the module, reference 25 °C); '
   'one aggregate system loss, 14 % as in the PVWatts API example (the API has no default); '
   'not modelled: inverter efficiency, clipping, incidence angle, spectrum, horizon in the hourly shape, nor a bifacial rear-side gain.'),
  ('pvsyst_like', 'Like PVsyst', null, null, null, 'pvsyst', '{"u_c": 29, "u_v": 0, "alpha_absorption": 0.9}', null,
   '[{"code": "iam", "pct": null}, {"code": "soiling", "pct": 2}, {"code": "lid", "pct": 2}, {"code": "module_quality", "pct": -0.75},
     {"code": "mismatch", "pct": 2}, {"code": "dc_wiring", "pct": 1.5}, {"code": "ac_wiring", "pct": 1}, {"code": "availability", "pct": 0}]',
   true, 'solar',
   'What a PVsyst 8 simulation assumes. Published by PVsyst: the PVsyst thermal model with Uc 29 and Uv 0 for free-standing modules (20 semi-integrated, 15 insulated back; alpha 0.9); '
   'the losses in the order of PVsyst''s loss diagram, each relative to the energy left by the previous ones (incidence computed, from the module''s PAN when imported); '
   'inverter overload losses, hence clipping. '
   'Not verified: PVsyst''s default transposition (left null; pvlib''s default is Hay-Davies) and decomposition (null); the percentages soiling 2 %, light-induced degradation 2 %, '
   'module quality -0.75 % (a gain), mismatch 2 %, DC wiring 1.5 %, AC wiring 1 %, unavailability 0 % are usual starting values, not defaults found in its documentation; replace them with the study''s. '
   'Irradiance level and thermal losses come from the models.'),
  ('pvsol_like', 'Like PV*SOL', 'hofmann', 'haydavies', null, 'delta_t',
   '{"reference_irradiance_w_m2": 1000, "delta_t_k": {"open_rack": 22, "roof_parallel": 29, "semi_integrated": 32, "insulated": 43, "floating": 20}}', null,
   '[{"code": "soiling", "pct": null}, {"code": "mismatch", "pct": null}, {"code": "dc_wiring", "pct": null}, {"code": "ac_wiring", "pct": null}]',
   true, 'solar',
   'What PV*SOL premium 2026 does in its hourly mode. Published defaults of PV*SOL: Hofmann (2017) decomposition, Hay-Davies transposition, '
   'module temperature = ambient + delta_t x irradiance / 1000 W/m2 with no wind term, delta_t by mounting: '
   '22 K free-standing, 29 K roof-parallel ventilated, 32 K integrated ventilated, 43 K integrated not ventilated, 20 K floating '
   '(PV*SOL''s "on roof" class, 28 K, has no mounting of its own here). '
   'Not verified: PV*SOL''s own loss names and default values (the list carries the usual steps without percentages, to be filled from the study being reproduced), '
   'its incidence and spectral models (null), and its clipping (set, as for any inverter model).');

-- ---------------------------------------------------------------------------
-- Quantities the module reads and writes. Production power and energy and
-- the generic irradiance are the core's.
-- ---------------------------------------------------------------------------

insert into quantities (code, name, unit, aggregation, qudt_quantity_kind, description, published_by) values
  ('ghi',                'Global horizontal irradiance', 'W-PER-M2', 'mean', 'Irradiance',  'Total irradiance on a horizontal plane.', 'solar'),
  ('dni',                'Direct normal irradiance',     'W-PER-M2', 'mean', 'Irradiance',  'Irradiance from the sun''s disc on a plane facing it.', 'solar'),
  ('dhi',                'Diffuse horizontal irradiance','W-PER-M2', 'mean', 'Irradiance',  'Irradiance from the sky but the sun''s disc, on a horizontal plane.', 'solar'),
  ('poa_irradiance',     'Plane-of-array irradiance',    'W-PER-M2', 'mean', 'Irradiance',  'Total irradiance on the plane of a PV array.', 'solar'),
  ('module_temperature', 'Module temperature',           'DEG_C',    'mean', 'Temperature', 'Temperature of a PV module (cell temperature when modelled).', 'solar');

-- ---------------------------------------------------------------------------
-- The loss chain and the exceedance levels of an estimate, as rows.
-- ---------------------------------------------------------------------------

-- The losses a yield is computed with, one word each, in the stage of the
-- chain they act at: the light reaching the modules (soiling, shading,
-- incidence, spectrum, snow), the DC side (light-induced degradation,
-- module quality, mismatch, DC wiring, ageing), the conversion (inverter,
-- clipping), the AC side (AC wiring, transformer) and the system as a
-- whole (availability, or one aggregate loss when a profile gives one).
create table solar.loss_kinds (
  code          text primary key,
  name          text not null,
  stage         text not null,
  description   text,
  published_by  text not null default 'solar',
  constraint loss_kinds_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint loss_kinds_stage check (stage in ('irradiance', 'dc', 'conversion', 'ac', 'system'))
);

comment on table solar.loss_kinds is
  'The losses of a PV yield, each at its stage of the chain (irradiance, dc, conversion, ac, system), in the words of PVsyst''s loss diagram and IEC 61724. A vocabulary: the codes of yield_profiles.losses and of solar.estimate_losses.';

insert into solar.loss_kinds (code, name, stage, description) values
  ('soiling',        'Soiling',                     'irradiance', 'Light taken by dirt on the modules.'),
  ('shading',        'Shading',                     'irradiance', 'Light taken by near obstacles and the rows in front.'),
  ('snow',           'Snow',                        'irradiance', 'Light taken by snow lying on the modules.'),
  ('iam',            'Incidence angle',             'irradiance', 'Light reflected by the glass at oblique incidence.'),
  ('spectral',       'Spectrum',                    'irradiance', 'The difference of the spectrum from the reference one.'),
  ('lid',            'Light-induced degradation',   'dc',         'The power the cells lose in their first hours in the sun.'),
  ('module_quality', 'Module quality',              'dc',         'The power of the modules against their nameplate; negative: a gain.'),
  ('mismatch',       'Mismatch',                    'dc',         'Modules of slightly different currents in one string.'),
  ('dc_wiring',      'DC wiring',                   'dc',         'Ohmic losses of the DC cables.'),
  ('degradation',    'Ageing',                      'dc',         'The power lost year after year, at the year of the estimate.'),
  ('inverter',       'Inverter',                    'conversion', 'The efficiency of the conversion from DC to AC.'),
  ('clipping',       'Clipping',                    'conversion', 'DC power above the AC limit of the inverter, cut.'),
  ('ac_wiring',      'AC wiring',                   'ac',         'Ohmic losses of the AC cables to the connection point.'),
  ('transformer',    'Transformer',                 'ac',         'The losses of a transformer to medium voltage.'),
  ('availability',   'Unavailability',              'system',     'Energy lost while the system is down.'),
  ('system',         'System, aggregate',           'system',     'One loss for all of the above, as PVGIS and PVWatts take it.');

alter table solar.loss_kinds enable row level security;
create policy loss_kinds_read on solar.loss_kinds for select to authenticated using (true);
grant select on solar.loss_kinds to authenticated;
grant select, insert, update, delete on solar.loss_kinds to service_role;

-- The chain an estimate was computed with, in its order, each loss
-- applying to what the previous ones left: its fraction (null when a model
-- of the engine computes it), where it was read and the status of the
-- value (value_statuses: a profile's usual starting value is a default, a
-- place's measured soiling is measured).
create table solar.estimate_losses (
  estimate_id      uuid not null references solar.estimates(id) on delete cascade,
  -- Copied from the estimate by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The array it holds for, by name, when the arrays of a system differ; null: every array.
  array_name       text,
  position         integer not null,
  code             text not null references solar.loss_kinds(code),
  fraction         numeric,
  source_code      text references sources(code),
  reference        text,
  status           value_quality not null,
  primary key (estimate_id, position),
  constraint estimate_losses_fraction check (fraction is null or (fraction > -1 and fraction < 1))
);

comment on table solar.estimate_losses is
  'The loss chain of an estimate, one row per loss in its order: its code (solar.loss_kinds), its fraction (null: computed by a model of the engine), the array it holds for when the arrays differ, where it was read (a source and a reference: a yield profile, a parameter of the place) and the status of the value.';

-- The energy a year exceeds with a probability, one row per level: P50 and
-- what was asked for (P75, P90, P95, P99).
create table solar.estimate_levels (
  estimate_id      uuid not null references solar.estimates(id) on delete cascade,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  probability      numeric not null,
  energy_kwh       numeric not null,
  primary key (estimate_id, probability),
  constraint estimate_levels_probability check (probability > 0 and probability < 100)
);

comment on table solar.estimate_levels is
  'The exceedance levels of an exceedance estimate, one row per probability: P50 always, and the levels asked for (P75, P90, P95, P99), the annual energy exceeded with that probability.';

create or replace function solar.estimate_child_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select e.organisation_id from solar.estimates e where e.id = new.estimate_id);
  if new.organisation_id is null then
    raise exception 'estimate_not_found: %', new.estimate_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function solar.estimate_child_check() is
  'BEFORE INSERT / UPDATE on solar.estimate_losses and solar.estimate_levels: copies the organisation of the estimate (estimate_not_found).';

create trigger estimate_losses_check before insert or update on solar.estimate_losses
  for each row execute function solar.estimate_child_check();
create trigger estimate_levels_check before insert or update on solar.estimate_levels
  for each row execute function solar.estimate_child_check();
call secure_table('solar.estimate_losses', 'project_of(''device'', (select e.device_id from solar.estimates e where e.id = estimate_id))',
  '(select coalesce(e.participant_id, participant_of(''device'', e.device_id)) from solar.estimates e where e.id = estimate_id)');
call secure_table('solar.estimate_levels', 'project_of(''device'', (select e.device_id from solar.estimates e where e.id = estimate_id))',
  '(select coalesce(e.participant_id, participant_of(''device'', e.device_id)) from solar.estimates e where e.id = estimate_id)');

grant execute on function solar.system_kwp(uuid, uuid), solar.horizon_profile_valid(jsonb), solar.losses_valid(jsonb),
  solar.variant_chain(uuid), solar.create_variant(uuid, text, uuid, text)
  to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('solar', 'Solar', '0.3.0', 'solar', '0.3.0',
        'PV systems and arrays, module and inverter product physics, horizons, named yield profiles and design variants: what a PV yield is computed from, and the estimates computed from them, with their loss chain and exceedance levels as rows.');
