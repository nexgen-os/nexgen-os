-- Nexgen OS — module `solar`: photovoltaic systems and what a yield is
-- computed from.
--
-- Decision 0012. A PV system is a device of type `solar`, derived into
-- `solar.pv_systems` with the same id. It is made of arrays: one group of
-- modules with one orientation each (pvlib's Array, PVsyst's orientation,
-- OpenSolar's module group, Orange Button's PVArray). The physics of a
-- module or an inverter product is attached to its row of the core
-- `device_directory`, in pvlib's parameter names. A far horizon belongs to
-- a site or a surface. A yield profile is a named set of modelling choices
-- with an ordered list of losses, so that a run says what it was computed
-- with.
--
-- Conventions, everywhere in this schema: azimuth in degrees clockwise from
-- true north (180 = facing south), tilt in degrees from horizontal (0 =
-- flat). Every reader converts from the convention of its tool on the way
-- in. Engines (pvlib, PVGIS, SAM) run outside Postgres; their results come
-- back through `record_run()`.

set search_path = nexgen, public, extensions;

create schema solar;
grant usage on schema solar to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pv_systems — the PV system as a device.
-- ---------------------------------------------------------------------------

create table solar.pv_systems (
  id                        uuid primary key,
  -- Copied from the device by trigger, for row level security.
  organisation_id           uuid not null references organisations(id) on delete cascade,
  -- Peak DC power at standard test conditions, and the AC power the
  -- inverters may deliver. When the system has arrays, its DC power is the
  -- sum of theirs (`solar.system_kwp`).
  kwp_dc                    numeric(12, 3),
  kva_ac                    numeric(12, 3),
  -- injection: everything produced goes to the grid; self_consumption: the
  -- site uses what it can and injects the rest; off_grid: no connection.
  grid_connection           text,
  commissioned_on           date,
  -- Yearly loss of output from ageing, and the loss of the first months
  -- (light-induced degradation), in percent.
  degradation_pct_per_year  numeric(5, 3),
  first_year_loss_pct       numeric(5, 3),
  metadata                  jsonb not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint pv_systems_kwp_positive check (kwp_dc is null or kwp_dc >= 0),
  constraint pv_systems_kva_positive check (kva_ac is null or kva_ac >= 0),
  constraint pv_systems_grid_connection check (grid_connection is null or grid_connection in ('injection', 'self_consumption', 'off_grid')),
  constraint pv_systems_degradation_range check (degradation_pct_per_year is null or degradation_pct_per_year between 0 and 5),
  constraint pv_systems_first_year_loss_range check (first_year_loss_pct is null or first_year_loss_pct between 0 and 20)
);

comment on table solar.pv_systems is
  'A PV system: a device of type solar, with its DC and AC power, grid connection, commissioning date and degradation (Orange Button PVSystem). Read with `from devices join solar.pv_systems using (id)`.';

call derive_devices('solar.pv_systems', 'solar');

create or replace function solar.pv_systems_organisation()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from devices where id = new.id);
  return new;
end;
$$;

create trigger pv_systems_organisation before insert or update of id on solar.pv_systems
  for each row execute function solar.pv_systems_organisation();
create trigger pv_systems_set_updated_at before update on solar.pv_systems
  for each row execute function set_updated_at();
create index pv_systems_organisation_idx on solar.pv_systems (organisation_id);
call secure_table('solar.pv_systems');

-- ---------------------------------------------------------------------------
-- module_products, inverter_products — the physics of a product.
-- ---------------------------------------------------------------------------
--
-- The identity of a product (manufacturer, model, unit power, datasheet,
-- price) is its row of `device_directory`; these tables add, with the same
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
  id               uuid primary key references device_directory(id) on delete cascade,
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
  'The physics of a PV module product of device_directory, same id: a model family (pvsyst, cec, sapm, pvwatts) and its parameters in pvlib''s key names.';

create table solar.inverter_products (
  id               uuid primary key references device_directory(id) on delete cascade,
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
  'The physics of an inverter product of device_directory, same id: a model family (sandia, adr, pvwatts, ond) and its parameters in pvlib''s key names.';

-- BEFORE INSERT / UPDATE: the product exists, is of the device type named
-- by tg_argv[0] (or a refinement of it), and lends its organisation.
create or replace function solar.product_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  p device_directory%rowtype;
begin
  select * into p from device_directory where id = new.id;
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

-- Row level security as for device_directory: shared products (no
-- organisation) are read by everyone signed in and written by migrations,
-- modules and packs; an organisation's products by its members.
do $$
declare
  t text;
begin
  foreach t in array array['module_products', 'inverter_products'] loop
    execute format('create index %I on solar.%I (organisation_id)', t || '_organisation_idx', t);
    execute format('alter table solar.%I enable row level security', t);
    execute format('create policy %I on solar.%I for select to authenticated using (organisation_id is null or can_read_organisation(organisation_id))',
                   t || '_select', t);
    execute format('create policy %I on solar.%I for all to authenticated
                      using (organisation_id is not null and can_write_organisation(organisation_id))
                      with check (organisation_id is not null and can_write_organisation(organisation_id))',
                   t || '_write', t);
    execute format('grant select, insert, update, delete on solar.%I to authenticated, service_role', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- pv_arrays — one group of modules with one orientation.
-- ---------------------------------------------------------------------------

create table solar.pv_arrays (
  id                   uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id      uuid not null references organisations(id) on delete cascade,
  pv_system_id         uuid not null references solar.pv_systems(id) on delete cascade,
  -- The roof face, facade or ground area it sits on. Null for a rack or a
  -- tracker described without one.
  surface_id           uuid references surfaces(id) on delete set null,
  name                 text not null,
  -- Taken from the surface when not given; given for a rack on a flat roof
  -- or a ground mount. For a tracker: its axis, or null.
  azimuth_deg          numeric(6, 2),
  tilt_deg             numeric(5, 2),
  -- How the back of the modules is ventilated, which sets their temperature:
  -- open_rack (free-standing), roof_parallel (on a pitched roof, ventilated),
  -- semi_integrated, insulated (integrated, no ventilation), floating,
  -- tracker.
  mounting             text,
  module_product_id    uuid references device_directory(id) on delete set null,
  module_count         integer,
  modules_per_string   integer,
  strings              integer,
  inverter_product_id  uuid references device_directory(id) on delete set null,
  inverter_count       integer,
  -- Ground reflectance seen by the array, 0 to 1.
  albedo               numeric(4, 3),
  bifacial             boolean not null default false,
  -- Peak DC power. Computed from the module product's unit power and the
  -- module count when not given.
  kwp_dc               numeric(12, 3),
  metadata             jsonb not null default '{}',
  scenario_id          uuid references scenarios(id) on delete cascade,
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
  constraint pv_arrays_kwp_positive check (kwp_dc is null or kwp_dc >= 0)
);

comment on table solar.pv_arrays is
  'A group of modules with one orientation in a PV system: the surface it sits on, azimuth and tilt, mounting, module and inverter products and counts, string layout, albedo (pvlib Array, PVsyst orientation, OpenSolar module group, Orange Button PVArray).';

create index pv_arrays_system_idx on solar.pv_arrays (pv_system_id);
create index pv_arrays_surface_idx on solar.pv_arrays (surface_id);

-- BEFORE INSERT / UPDATE: the surface is on the system's site; orientation
-- comes from the surface and DC power from the module product when they
-- are not given.
create or replace function solar.pv_arrays_fill()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  s surfaces%rowtype;
begin
  if new.surface_id is not null then
    select * into s from surfaces where id = new.surface_id;
    if site_of(new.surface_id) is distinct from (select site_id from devices where id = new.pv_system_id) then
      raise exception 'array_outside_system_site' using errcode = 'check_violation';
    end if;
    new.azimuth_deg := coalesce(new.azimuth_deg, s.azimuth_deg);
    new.tilt_deg := coalesce(new.tilt_deg, s.tilt_deg);
  end if;
  if new.kwp_dc is null and new.module_count is not null and new.module_product_id is not null then
    new.kwp_dc := (select unit_power_kw * new.module_count from device_directory where id = new.module_product_id);
  end if;
  return new;
end;
$$;

create trigger pv_arrays_fill before insert or update on solar.pv_arrays
  for each row execute function solar.pv_arrays_fill();
call declare_object('solar.pv_arrays', 'pv_array', '{pv_system_id,surface_id}');

-- DC power of a system: the sum of its arrays, or its own figure when it
-- has none. In a scenario, the arrays of reality and of the scenario and
-- the scenarios it builds on.
create or replace function solar.system_kwp(p_system_id uuid, p_scenario_id uuid default null)
returns numeric
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id from scenarios s join chain on s.id = chain.parent_id
  )
  select coalesce(
    (select sum(a.kwp_dc) from solar.pv_arrays a
      where a.pv_system_id = p_system_id
        and (a.scenario_id is null or a.scenario_id in (select id from chain))),
    (select kwp_dc from solar.pv_systems where id = p_system_id)
  );
$$;

comment on function solar.system_kwp(uuid, uuid) is
  'Peak DC power of a PV system in kWp: the sum of its arrays, or the system''s own kwp_dc when it has no array.';

-- ---------------------------------------------------------------------------
-- horizons — the far horizon of a site or a surface.
-- ---------------------------------------------------------------------------

-- A profile is a non-empty array of [azimuth_deg, elevation_deg] pairs:
-- azimuth clockwise from true north in [0, 360), elevation of the horizon
-- above the horizontal in [-90, 90].
create or replace function solar.horizon_profile_valid(p_profile jsonb)
returns boolean
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
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
  object_id        uuid not null references objects(id) on delete cascade,
  profile          jsonb not null,
  -- Where it comes from: PVGIS's elevation model, a survey, a PVsyst or
  -- Meteonorm file.
  source_code      text references sources(code),
  metadata         jsonb not null default '{}',
  scenario_id      uuid references scenarios(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint horizons_profile_not_empty check (case when jsonb_typeof(profile) = 'array' then jsonb_array_length(profile) > 0 else false end),
  constraint horizons_profile_pairs check (solar.horizon_profile_valid(profile))
);

comment on table solar.horizons is
  'The far horizon of a site or a surface: [azimuth_deg, elevation_deg] pairs, azimuth clockwise from true north. One per object and scenario; every yield run on it reads it.';

create unique index horizons_one_per_object on solar.horizons (object_id, scenario_id) nulls not distinct;

create or replace function solar.horizons_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if (select kind from objects where id = new.object_id) not in ('site', 'surface') then
    raise exception 'horizon_on_site_or_surface_only' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Triggers fire in name order: attach first, then the kind check.
create trigger horizons_attach before insert or update on solar.horizons
  for each row execute function attach('object_id');
create trigger horizons_check before insert or update of object_id on solar.horizons
  for each row execute function solar.horizons_check();
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
-- the profile does not fix it: a model computes it (`iam`) or the run
-- supplies it. A negative percentage is a gain.

create or replace function solar.losses_valid(p_losses jsonb)
returns boolean
language sql
immutable
set search_path = nexgen, public, extensions, pg_temp
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
  'A named set of modelling choices for a PV yield: decomposition, transposition, incidence, temperature, spectral, an ordered list of losses, clipping. A yield run names the one it used.';

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

grant execute on function solar.system_kwp(uuid, uuid), solar.horizon_profile_valid(jsonb), solar.losses_valid(jsonb)
  to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('solar', 'Solar', '0.1.0', 'solar', '0.2.0',
        'PV systems and arrays, module and inverter product physics, horizons and named yield profiles: what a PV yield is computed from.');
