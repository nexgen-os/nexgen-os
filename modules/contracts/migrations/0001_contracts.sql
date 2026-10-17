-- Nexgen OS — module `contracts`: the contracts energy is bought and sold
-- under, and the prices they set.
--
-- A site buys from a supplier and sells its surplus to a buyer; a roof
-- plant sells its production to the company under it; a company signs a
-- virtual PPA with a wind farm far away; a community sets the price its
-- members pay for the energy they share. Each of these is a contract: two
-- parties, a delivery point (a meter, a participant, a project), the dates
-- it holds between, how its volume is counted, and its place in the order
-- in which a site's energy is matched with its contracts.
--
-- What a contract costs is a price signal: a value on an interval of time
-- (start and end, the ISO 8601 form `start/end`), fixed or indexed on a
-- named market index, with a cap or a floor, in the currency and per the
-- unit of energy the row says. An hourly grid is one row per hour, as
-- OpenADR 3 sends it. The module computes no amount: who owes how much to
-- whom over a month is a run, computed by an application or by an engine,
-- and the invoice lives in Ekwo (decision 0010).

set search_path = nexgen, public, extensions;

create schema contracts;
grant usage on schema contracts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- contract_types — what a contract is about, as data.
-- ---------------------------------------------------------------------------

create table contracts.contract_types (
  code          text primary key,
  name          text not null,
  -- The way energy goes for the holder of the delivery point: offtake
  -- (bought), injection (sold), or both.
  direction     text not null,
  -- Whether energy is delivered through the point (a supply, a physical
  -- PPA) or only settled against a price (a virtual PPA, a hedge).
  physical      boolean not null,
  description   text,
  published_by  text not null default 'contracts',
  constraint contract_types_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint contract_types_direction check (direction in ('offtake', 'injection', 'both'))
);

comment on table contracts.contract_types is
  'What a contract is about: supply, injection, physical or virtual PPA, a community''s internal tariff, a sale on the market. Vocabulary: read by everyone signed in, written by migrations, modules and packs.';

insert into contracts.contract_types (code, name, direction, physical, description) values
  ('supply',           'Supply',                 'offtake',   true,  'Energy bought from a supplier for what the delivery point takes from the grid.'),
  ('injection',        'Injection',              'injection', true,  'Energy the delivery point injects into the grid, sold to a buyer.'),
  ('ppa_physical',     'Physical PPA',           'offtake',   true,  'Energy bought directly from a producer, on the site or through the grid, delivered to the point.'),
  ('ppa_virtual',      'Virtual PPA',            'both',      false, 'A financial contract with a producer: the difference between an agreed price and a market index is settled, no energy is delivered.'),
  ('community_tariff', 'Community tariff',       'both',      true,  'The price a community sets for the energy its members share: paid by the one who takes it, received by the one who injects it.'),
  ('market',           'Market',                 'both',      true,  'Energy bought or sold at a market price through an aggregator or a balance responsible party.');

alter table contracts.contract_types enable row level security;
create policy contracts_contract_types_read on contracts.contract_types for select to authenticated using (true);
grant select on contracts.contract_types to authenticated;
grant select, insert, update, delete on contracts.contract_types to service_role;

-- ---------------------------------------------------------------------------
-- price_indices — the market indices a price may follow, as data.
-- ---------------------------------------------------------------------------

create table contracts.price_indices (
  code          text primary key,
  name          text not null,
  -- The currency (ISO 4217) and the unit of energy the index is quoted in.
  currency      char(3) not null,
  per_unit      text not null,
  -- Where its values come from: a market operator, a regulator, a pack.
  source_code   text references sources(code),
  description   text,
  -- A pack ('pack:fr'), a module, or the installation.
  published_by  text not null,
  constraint price_indices_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint price_indices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint price_indices_per_unit check (per_unit in ('KiloW-HR', 'MegaW-HR'))
);

comment on table contracts.price_indices is
  'The market indices an indexed price follows: a day-ahead price of a bidding zone, a monthly average, a regulated tariff, with its currency, its unit and its source. The module ships none: packs and the installation publish theirs.';

alter table contracts.price_indices enable row level security;
create policy contracts_price_indices_read on contracts.price_indices for select to authenticated using (true);
grant select on contracts.price_indices to authenticated;
grant select, insert, update, delete on contracts.price_indices to service_role;

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------

create table contracts.contracts (
  id                 uuid primary key default gen_random_uuid() references objects(id) on delete cascade deferrable initially deferred,
  organisation_id    uuid not null references organisations(id) on delete cascade,
  type               text not null references contracts.contract_types(code),
  name               text not null,
  -- The contract's number at the supplier, the buyer or the producer.
  reference          text,
  -- The two parties, as contacts (whose legal identity is Ekwo's). Null:
  -- the organisation that holds the row is the party.
  seller_contact_id  uuid references contacts(id) on delete set null,
  buyer_contact_id   uuid references contacts(id) on delete set null,
  -- What it covers: a connection point, a participant (behind its meters),
  -- or a whole project (a community's tariff). At least one.
  meter_id           uuid references meters(id) on delete cascade,
  participant_id     uuid references participants(id) on delete cascade,
  project_id         uuid references projects(id) on delete cascade,
  -- How its volume is counted: what the point takes (pay as consumed),
  -- what the producer makes (pay as produced), or a share of the
  -- producer's power (allocated power, with its kW).
  volume_basis       text not null default 'pay_as_consumed',
  allocated_power_kw numeric(12, 3),
  -- Its place in the order energy is matched with contracts: 1 first (an
  -- on-site PPA), then the community, then the supplier for the rest.
  priority           integer,
  -- The days it holds, the first included, the last excluded.
  valid_from         date not null,
  valid_to           date,
  status             text not null default 'signed',
  notes              text,
  tags               text[] not null default '{}',
  scenario_id        uuid references scenarios(id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint contracts_name_not_blank check (btrim(name) <> ''),
  constraint contracts_covers_something check (num_nonnulls(meter_id, participant_id, project_id) > 0),
  constraint contracts_two_parties check (seller_contact_id is not null or buyer_contact_id is not null),
  constraint contracts_parties_differ check (seller_contact_id <> buyer_contact_id),
  constraint contracts_volume_basis check (volume_basis in ('pay_as_consumed', 'pay_as_produced', 'allocated_power')),
  constraint contracts_allocated_power check ((volume_basis = 'allocated_power') = (allocated_power_kw is not null)),
  constraint contracts_allocated_power_positive check (allocated_power_kw is null or allocated_power_kw > 0),
  constraint contracts_priority_positive check (priority is null or priority > 0),
  constraint contracts_period check (valid_to is null or valid_to > valid_from),
  constraint contracts_status check (status in ('draft', 'signed', 'cancelled')),
  constraint contracts_tags_known check (tags_known(tags))
);

comment on table contracts.contracts is
  'A contract energy is bought or sold under: its type, its two parties, what it covers (a meter, a participant, a project), how its volume is counted, its priority among the contracts of a point, the days it holds. An object: the signed document and its amendments attach to it.';

create index contracts_meter_idx on contracts.contracts (meter_id);
create index contracts_participant_idx on contracts.contracts (participant_id);
create index contracts_project_idx on contracts.contracts (project_id);
call declare_object('contracts.contracts', 'contract', '{meter_id,participant_id,project_id}');

-- The parties are contacts of the organisation; a participant is in the
-- project the contract names; a meter is one the participant is behind.
create or replace function contracts.contracts_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if exists (select 1 from contacts c
              where c.id in (new.seller_contact_id, new.buyer_contact_id)
                and c.organisation_id <> new.organisation_id) then
    raise exception 'contact_in_other_organisation' using errcode = 'check_violation';
  end if;
  if new.participant_id is not null and new.project_id is not null
     and not exists (select 1 from participants p where p.id = new.participant_id and p.project_id = new.project_id) then
    raise exception 'participant_in_other_project: %', new.participant_id using errcode = 'check_violation';
  end if;
  if new.participant_id is not null and new.meter_id is not null
     and not exists (select 1 from participant_meters(new.participant_id) m where m.meter_id = new.meter_id) then
    raise exception 'meter_not_behind_participant: %', new.meter_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger contracts_check
  before insert or update of seller_contact_id, buyer_contact_id, meter_id, participant_id, project_id, organisation_id on contracts.contracts
  for each row execute function contracts.contracts_check();

-- ---------------------------------------------------------------------------
-- price_signals — what a contract costs, on intervals of time.
-- ---------------------------------------------------------------------------

create table contracts.price_signals (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  contract_id       uuid not null references contracts.contracts(id) on delete cascade,
  -- fixed: a price; indexed: multiplier × index + adder; cap and floor:
  -- the most and the least the price of the contract may be.
  kind              text not null,
  -- The interval, start included, end excluded; no end: until further notice.
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  price             numeric(14, 6),
  index_code        text references contracts.price_indices(code),
  index_multiplier  numeric(10, 6),
  index_adder       numeric(14, 6),
  -- The currency (ISO 4217) and the unit of energy of the price.
  currency          char(3) not null,
  per_unit          text not null,
  -- Who says so: the contract, an amendment, a published tariff.
  source            text not null,
  scenario_id       uuid references scenarios(id) on delete cascade,
  created_at        timestamptz not null default now(),
  constraint price_signals_kind check (kind in ('fixed', 'indexed', 'cap', 'floor')),
  constraint price_signals_interval check (ends_at is null or ends_at > starts_at),
  constraint price_signals_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint price_signals_per_unit check (per_unit in ('KiloW-HR', 'MegaW-HR')),
  constraint price_signals_source_not_blank check (btrim(source) <> ''),
  -- A fixed price, a cap or a floor is a price; an indexed one names its
  -- index and its multiplier, and has no price of its own.
  constraint price_signals_shape check (
    case when kind = 'indexed'
         then price is null and index_code is not null and index_multiplier is not null
         else price is not null and index_code is null and index_multiplier is null and index_adder is null
    end)
);

comment on table contracts.price_signals is
  'What a contract costs on an interval of time: a fixed price, a price indexed on a named market index (multiplier × index + adder), a cap or a floor, in the currency and per the unit of energy of the row, with who says so. An hourly grid is one row per hour; intervals of one kind never overlap in a contract.';

create index price_signals_contract_idx on contracts.price_signals (contract_id, kind, starts_at);
call secure_table('contracts.price_signals');

-- A signal is of its contract's organisation and scenario; an indexed price
-- is quoted like its index, since the module converts no currency; two
-- signals of one kind never cover the same instant of a contract.
create or replace function contracts.price_signals_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  c  contracts.contracts%rowtype;
  i  contracts.price_indices%rowtype;
begin
  select * into c from contracts.contracts where id = new.contract_id;
  if c.organisation_id <> new.organisation_id then
    raise exception 'contract_in_other_organisation: %', new.contract_id using errcode = 'check_violation';
  end if;
  if c.scenario_id is not null and c.scenario_id is distinct from new.scenario_id then
    raise exception 'contract_in_other_scenario: %', new.contract_id using errcode = 'check_violation';
  end if;
  if new.index_code is not null then
    select * into i from contracts.price_indices where code = new.index_code;
    if i.currency <> new.currency or i.per_unit <> new.per_unit then
      raise exception 'index_quoted_otherwise: % is in % per %', i.code, i.currency, i.per_unit using errcode = 'check_violation';
    end if;
  end if;
  if exists (
    select 1 from contracts.price_signals s
     where s.contract_id = new.contract_id
       and s.kind = new.kind
       and s.scenario_id is not distinct from new.scenario_id
       and s.id <> new.id
       and tstzrange(s.starts_at, s.ends_at) && tstzrange(new.starts_at, new.ends_at)
  ) then
    raise exception 'price_signal_overlap: % of contract %', new.kind, new.contract_id using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

create trigger price_signals_check
  before insert or update on contracts.price_signals
  for each row execute function contracts.price_signals_check();

-- ---------------------------------------------------------------------------
-- in_force — the contracts of a point on a day, in the order they apply.
-- ---------------------------------------------------------------------------

-- The contracts that cover a meter (on the meter, or on a participant
-- behind it), a participant (on it, or on one of its meters) or a project
-- (on the project, or on one of its participants), signed, holding on the
-- day, in the world as it is or in a scenario; by priority, those
-- without a priority last. The day is always given: the same call gives the
-- same answer. It reads under the caller's row level security.
create or replace function contracts.in_force(p_object_id uuid, p_on date, p_scenario_id uuid default null)
returns jsonb
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id from scenarios s join chain on s.id = chain.parent_id
  ),
  named as (
    select p.id from participants p where p.id = p_object_id or p.project_id = p_object_id
  ),
  meters_of as (
    select p_object_id as id
    union
    select m.meter_id from named p, participant_meters(p.id) m
  ),
  -- The participants behind those meters: the groups that gather them too.
  participants_of as (
    select id from named
    union
    select p.id from participants p, participant_meters(p.id) m where m.meter_id in (select id from meters_of)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'type', c.type, 'direction', t.direction, 'physical', t.physical,
           'priority', c.priority, 'volume_basis', c.volume_basis, 'allocated_power_kw', c.allocated_power_kw,
           'meter_id', c.meter_id, 'participant_id', c.participant_id, 'project_id', c.project_id,
           'valid_from', c.valid_from, 'valid_to', c.valid_to)
         order by c.priority nulls last, c.valid_from, c.name), '[]'::jsonb)
    from contracts.contracts c
    join contracts.contract_types t on t.code = c.type
   where c.status = 'signed'
     and c.valid_from <= p_on and (c.valid_to is null or c.valid_to > p_on)
     and (c.scenario_id is null or c.scenario_id in (select id from chain))
     and (c.project_id = p_object_id
          or c.meter_id in (select id from meters_of)
          or c.participant_id in (select id from participants_of));
$$;

comment on function contracts.in_force(uuid, date, uuid) is
  'The contracts that cover a meter, a participant or a project on a day, in the order they apply. Reads under the caller''s row level security.';

grant execute on function contracts.in_force(uuid, date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- prices_at — what a contract sets at an instant.
-- ---------------------------------------------------------------------------

-- The signals of a contract that cover an instant, one per kind: in a
-- scenario, the scenario's own signal before its parent's, and those before
-- the world as it is. It computes no price from an index: it says which
-- index, multiplier and adder hold, and the run that settles reads the
-- index's value.
create or replace function contracts.prices_at(p_contract_id uuid, p_at timestamptz, p_scenario_id uuid default null)
returns jsonb
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  with recursive chain as (
    select s.id, s.parent_id, 0 as depth from scenarios s where s.id = p_scenario_id
    union all
    select s.id, s.parent_id, chain.depth + 1 from scenarios s join chain on s.id = chain.parent_id
  ),
  candidates as (
    select distinct on (s.kind) s.*
      from contracts.price_signals s
      left join chain on chain.id = s.scenario_id
     where s.contract_id = p_contract_id
       and (s.scenario_id is null or chain.id is not null)
       and s.starts_at <= p_at and (s.ends_at is null or s.ends_at > p_at)
     order by s.kind, chain.depth nulls last
  )
  select jsonb_build_object(
    'contract_id', p_contract_id,
    'at', p_at,
    'signals', coalesce(jsonb_object_agg(kind, jsonb_strip_nulls(jsonb_build_object(
      'id', id, 'starts_at', starts_at, 'ends_at', ends_at, 'price', price,
      'index_code', index_code, 'index_multiplier', index_multiplier, 'index_adder', index_adder,
      'currency', currency, 'per_unit', per_unit, 'source', source))) filter (where kind is not null), '{}'::jsonb))
  from candidates;
$$;

comment on function contracts.prices_at(uuid, timestamptz, uuid) is
  'The price signals of a contract that hold at an instant, one per kind (fixed, indexed, cap, floor). Reads under the caller''s row level security.';

grant execute on function contracts.prices_at(uuid, timestamptz, uuid) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('contracts', 'Contracts', '0.1.0', 'contracts', '0.1.0',
        'The contracts energy is bought and sold under — supply, injection, physical and virtual PPAs, a community''s tariff, the market — with their parties, what they cover, their priority and their dates, and the prices they set on intervals of time, fixed or indexed, with a cap or a floor.');
