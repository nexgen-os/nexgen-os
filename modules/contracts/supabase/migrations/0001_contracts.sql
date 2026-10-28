-- Nexgen OS — module `contracts`: the contracts of a participant and their prices.
--
-- A participant is the node (decision 0043): the energy taken from and
-- injected into the grid at its meters is bought and sold under contracts —
-- a supply contract, an injection contract, a physical or virtual power
-- purchase agreement, the internal tariff of a community, the market. This
-- module keeps each contract as a row about its participant, with the other
-- party, the flow it prices, how its volume is counted, its priority in a
-- cascade and its period, and the prices it sets as price signals: a fixed
-- price, or an index read on a price series of the core (A × index + B,
-- with a floor and a cap), each over an ISO 8601 period (a start and a
-- duration). A market price stays a series of the core (`energy_price` of a
-- bidding zone); a signal points to it and never copies it. The amounts are
-- a settlement, computed by a program (decision 0013) from the contracts in
-- force and their prices; the invoice is the invoicing side's (decision
-- 0010). The support contract of a producing device under a scheme of its
-- country stays the grid's (`grid.support_contracts`, decision 0049).

set search_path = nexgen, extensions;

create schema contracts;
grant usage on schema contracts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kinds — what a contract is.
-- ---------------------------------------------------------------------------

create table contracts.kinds (
  code         text primary key,
  name         text not null,
  -- The flows of the participant's meter a contract of this kind may price,
  -- from the participant's point of view: `offtake` (what it takes from the
  -- grid), `injection` (what it injects).
  flows        text[] not null,
  -- Whether the energy is delivered under the contract (false: a financial
  -- contract settled against a price, the energy sold elsewhere).
  delivered    boolean not null,
  description  text,
  constraint kinds_code_format check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint kinds_flows check (cardinality(flows) > 0 and flows <@ array['offtake', 'injection'])
);

comment on table contracts.kinds is
  'What a contract is: the flows of the participant''s meter it may price (offtake, injection) and whether the energy is delivered under it. Read by everyone signed in.';

insert into contracts.kinds (code, name, flows, delivered, description) values
  ('supply', 'Supply contract', '{offtake}', true,
   'The energy a participant takes from the grid, bought from a supplier.'),
  ('injection', 'Injection contract', '{injection}', true,
   'The energy a participant injects into the grid, sold to a buyer.'),
  ('ppa_physical', 'Physical power purchase agreement', '{offtake,injection}', true,
   'Energy of a producer delivered to a consumer at an agreed price, on site or through the grid; the participant is either side.'),
  ('ppa_virtual', 'Virtual power purchase agreement', '{offtake,injection}', false,
   'A financial contract for difference between an agreed price and a market price; the energy is bought and sold elsewhere.'),
  ('community_tariff', 'Internal tariff of a community', '{offtake,injection}', true,
   'The price at which the energy shared inside a project is bought by its participants and sold by its producers.'),
  ('market', 'Market price', '{offtake,injection}', true,
   'Energy bought or sold at a market price, the fallback of a cascade.');

alter table contracts.kinds enable row level security;
create policy contracts_kinds_read on contracts.kinds for select to authenticated using (true);
grant select on contracts.kinds to authenticated;
grant select, insert, update, delete on contracts.kinds to service_role;

-- ---------------------------------------------------------------------------
-- volume_modes — how the energy of a contract is counted.
-- ---------------------------------------------------------------------------

create table contracts.volume_modes (
  code         text primary key,
  name         text not null,
  description  text,
  constraint volume_modes_code_format check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table contracts.volume_modes is
  'How the energy of a contract is counted on each interval. Read by everyone signed in.';

insert into contracts.volume_modes (code, name, description) values
  ('metered', 'Metered', 'All the energy of the flow measured at the meter, or what the contracts before it in the cascade left.'),
  ('pay_as_consumed', 'Pay as consumed', 'The energy produced under the contract that the participant consumed on the interval.'),
  ('pay_as_produced', 'Pay as produced', 'All the energy produced under the contract on the interval, consumed or not.'),
  ('allocated_power', 'Allocated power', 'At most the power allocated to the contract over the interval.');

alter table contracts.volume_modes enable row level security;
create policy contracts_volume_modes_read on contracts.volume_modes for select to authenticated using (true);
grant select on contracts.volume_modes to authenticated;
grant select, insert, update, delete on contracts.volume_modes to service_role;

-- ---------------------------------------------------------------------------
-- contracts — a contract of a participant.
-- ---------------------------------------------------------------------------

create table contracts.contracts (
  id                          uuid primary key default gen_random_uuid(),
  -- Copied from the participant by trigger.
  organisation_id             uuid not null references organisations(id) on delete cascade,
  -- The participant whose energy the contract prices.
  participant_id              uuid not null references participants(id) on delete cascade,
  kind                        text not null references contracts.kinds(code),
  -- The flow of the participant's meter it prices, from its point of view.
  flow                        text not null,
  -- The other party: a participant of the same project (the producer of a
  -- PPA inside a community), or a contact of the organisation (a supplier,
  -- a buyer); none for the market.
  counterparty_participant_id uuid references participants(id) on delete cascade,
  counterparty_contact_id     uuid references contacts(id) on delete set null,
  -- The meter of the participant the energy is counted at; null for all its
  -- meters.
  meter_id                    uuid references meters(id) on delete cascade,
  volume_mode                 text not null default 'metered' references contracts.volume_modes(code),
  -- The power allocated to the contract, for `allocated_power`.
  allocated_power_kw          numeric,
  -- The order of the cascade: on an interval, the contracts of a flow take
  -- their volume by ascending priority, the market last.
  priority                    int not null default 0,
  valid_from                  date not null,
  -- The day after its last; null while it runs.
  valid_to                    date,
  -- The currency its prices count in: that of the participant's country
  -- when none is named.
  currency                    char(3) not null references currencies(code),
  -- The contract's own reference at the other party.
  reference                   text,
  -- The signed contract, a document of the organisation.
  document_id                 uuid references documents(id) on delete set null,
  source_code                 text references sources(code),
  source                      text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint contracts_flow check (flow in ('offtake', 'injection')),
  constraint contracts_period check (valid_to is null or valid_to > valid_from),
  constraint contracts_allocated_power check (allocated_power_kw is null or allocated_power_kw > 0),
  constraint contracts_one_counterparty check (counterparty_participant_id is null or counterparty_contact_id is null)
);

comment on table contracts.contracts is
  'A contract of a participant: its kind, the flow of its meter it prices (offtake or injection), the other party (a participant of the same project or a contact), the meter, how its volume is counted, its priority in the cascade of the flow, its period, the currency of its prices, its reference and its document. Its prices are contracts.price_signals.';

create index contracts_participant_idx on contracts.contracts (participant_id, flow, valid_from);

create or replace function contracts.contracts_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  p  participants%rowtype;
  k  contracts.kinds%rowtype;
begin
  select * into p from participants where id = new.participant_id;
  if p.id is null then
    raise exception 'participant_not_found: %', new.participant_id using errcode = 'foreign_key_violation';
  end if;
  new.organisation_id := p.organisation_id;
  select * into k from contracts.kinds where code = new.kind;
  if k.code is not null and not (new.flow = any (k.flows)) then
    raise exception 'flow_not_of_kind: a % contract prices %, not %', k.code, array_to_string(k.flows, ' or '), new.flow
      using errcode = 'check_violation';
  end if;
  if new.meter_id is not null and not exists (select 1 from meters m where m.id = new.meter_id and m.participant_id = p.id) then
    raise exception 'meter_of_other_participant: meter % is not carried by participant %', new.meter_id, p.id
      using errcode = 'check_violation';
  end if;
  if new.counterparty_participant_id is not null then
    if new.counterparty_participant_id = p.id then
      raise exception 'counterparty_is_participant: participant % cannot be its own counterparty', p.id using errcode = 'check_violation';
    end if;
    if not exists (select 1 from participants c where c.id = new.counterparty_participant_id and c.project_id = p.project_id) then
      raise exception 'counterparty_of_other_project: participant % is not of the project of participant %', new.counterparty_participant_id, p.id
        using errcode = 'check_violation';
    end if;
  end if;
  if new.counterparty_contact_id is not null
     and not exists (select 1 from contacts c where c.id = new.counterparty_contact_id and c.organisation_id = p.organisation_id) then
    raise exception 'contact_of_other_organisation: contact % is not of the organisation of participant %', new.counterparty_contact_id, p.id
      using errcode = 'check_violation';
  end if;
  if new.document_id is not null
     and not exists (select 1 from documents d where d.id = new.document_id and d.organisation_id = p.organisation_id) then
    raise exception 'document_of_other_organisation: document % is not of the organisation of participant %', new.document_id, p.id
      using errcode = 'check_violation';
  end if;
  if new.volume_mode = 'allocated_power' and new.allocated_power_kw is null then
    raise exception 'allocated_power_required: an allocated_power contract names the power it is allocated' using errcode = 'not_null_violation';
  end if;
  if new.volume_mode <> 'allocated_power' and new.allocated_power_kw is not null then
    raise exception 'allocated_power_not_counted: a % contract does not count an allocated power', new.volume_mode using errcode = 'check_violation';
  end if;
  new.currency := coalesce(new.currency, currency_of('participant', p.id));
  if new.currency is null then
    raise exception 'currency_required: participant % has no country whose currency the contract counts in; name it', p.id
      using errcode = 'not_null_violation';
  end if;
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency
     and exists (select 1 from contracts.price_signals s where s.contract_id = new.id) then
    raise exception 'currency_edited: the prices of contract % count in %', old.id, old.currency using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function contracts.contracts_check() is
  'BEFORE INSERT / UPDATE on contracts.contracts: copies the organisation of the participant (participant_not_found); the flow is one its kind prices (flow_not_of_kind); the meter is the participant''s (meter_of_other_participant); a counterparty participant is another participant of its project (counterparty_is_participant, counterparty_of_other_project), a counterparty contact and the document are of its organisation (contact_of_other_organisation, document_of_other_organisation); an allocated power is named for allocated_power only (allocated_power_required, allocated_power_not_counted); the currency is that of the participant''s country when none is named (currency_required) and never changes once a price counts in it (currency_edited).';

create trigger contracts_check before insert or update on contracts.contracts
  for each row execute function contracts.contracts_check();
call secure_table('contracts.contracts', 'project_of(''participant'', participant_id)', 'participant_id');

-- ---------------------------------------------------------------------------
-- price_signals — the prices a contract sets, over periods.
-- ---------------------------------------------------------------------------

create table contracts.price_signals (
  id               uuid primary key default gen_random_uuid(),
  -- Copied from the contract by trigger.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  contract_id      uuid not null references contracts.contracts(id) on delete cascade,
  -- The price it is: a priced quantity of the core (`energy_price` per MWh,
  -- `power_price` per kW and per year, `fixed_price` per month), in the
  -- currency of the contract.
  component        text not null references quantities(code),
  -- `fixed`: the price is `value`; `indexed`: factor × the value of the
  -- index series at the instant + value.
  form             text not null,
  value            numeric,
  factor           numeric,
  -- A price series of the core of the same quantity and currency (the
  -- day-ahead price of a bidding zone), read at each instant.
  index_series_id  uuid references series(id) on delete restrict,
  -- Bounds of an indexed price, after the formula.
  floor            numeric,
  cap              numeric,
  -- The ISO 8601 period it holds over: its start and its duration; no
  -- duration while it runs.
  valid_from       timestamptz not null,
  duration         interval,
  source_code      text references sources(code),
  source           text,
  created_at       timestamptz not null default now(),
  constraint price_signals_form check (form in ('fixed', 'indexed')),
  constraint price_signals_fixed check (form <> 'fixed' or (value is not null and factor is null and index_series_id is null)),
  constraint price_signals_indexed check (form <> 'indexed' or index_series_id is not null),
  constraint price_signals_bounds check (floor is null or cap is null or floor <= cap),
  constraint price_signals_duration check (duration is null or duration > interval '0')
);

comment on table contracts.price_signals is
  'A price a contract sets over an ISO 8601 period (valid_from and duration): a component (energy_price, power_price, fixed_price) in the currency of the contract, fixed (value) or indexed on a price series of the core (factor × index + value, within floor and cap). Two signals of one component of a contract never overlap.';

create index price_signals_contract_idx on contracts.price_signals (contract_id, component, valid_from);

create or replace function contracts.price_signals_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c  contracts.contracts%rowtype;
  s  series%rowtype;
begin
  select * into c from contracts.contracts where id = new.contract_id;
  if c.id is null then
    raise exception 'contract_not_found: %', new.contract_id using errcode = 'foreign_key_violation';
  end if;
  new.organisation_id := c.organisation_id;
  if not quantity_priced(new.component) then
    raise exception 'component_not_priced: % is not a price', new.component using errcode = 'check_violation';
  end if;
  if new.index_series_id is not null then
    select * into s from series where id = new.index_series_id;
    if s.organisation_id is distinct from c.organisation_id then
      raise exception 'series_of_other_organisation: series % is not of the organisation of contract %', new.index_series_id, c.id
        using errcode = 'check_violation';
    end if;
    if s.quantity_code <> new.component then
      raise exception 'index_of_other_quantity: series % is a %, the signal a %', s.id, s.quantity_code, new.component
        using errcode = 'check_violation';
    end if;
    if s.currency is distinct from c.currency then
      raise exception 'currency_mismatch: series % counts in %, contract % in %', s.id, coalesce(s.currency, 'no currency'), c.id, c.currency
        using errcode = 'check_violation';
    end if;
  end if;
  if new.form = 'indexed' then
    new.factor := coalesce(new.factor, 1);
    new.value := coalesce(new.value, 0);
  end if;
  if exists (select 1 from contracts.price_signals x
              where x.contract_id = new.contract_id and x.component = new.component and x.id <> new.id
                and tstzrange(x.valid_from, x.valid_from + x.duration) && tstzrange(new.valid_from, new.valid_from + new.duration)) then
    raise exception 'overlapping_value: contract % already has a % over that period', new.contract_id, new.component
      using errcode = 'exclusion_violation';
  end if;
  return new;
end;
$$;

comment on function contracts.price_signals_check() is
  'BEFORE INSERT / UPDATE on contracts.price_signals: copies the organisation of the contract (contract_not_found); the component is a price (component_not_priced); an index series is of the contract''s organisation, of the same quantity and of its currency (series_of_other_organisation, index_of_other_quantity, currency_mismatch); an indexed price defaults to 1 × index + 0; two signals of one component of a contract never overlap (overlapping_value).';

create trigger price_signals_check before insert or update on contracts.price_signals
  for each row execute function contracts.price_signals_check();
call secure_table('contracts.price_signals',
  'project_of(''participant'', (select c.participant_id from contracts.contracts c where c.id = contract_id))',
  '(select c.participant_id from contracts.contracts c where c.id = contract_id)');

-- ---------------------------------------------------------------------------
-- Reading: the contracts in force, the price at an instant.
-- ---------------------------------------------------------------------------

create or replace function contracts.in_force(p_participant_id uuid, p_flow text, p_on date default current_date)
returns setof contracts.contracts
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  select c.* from contracts.contracts c
   where c.participant_id = p_participant_id and c.flow = p_flow
     and c.valid_from <= p_on and (c.valid_to is null or c.valid_to > p_on)
   order by c.priority, c.valid_from, c.created_at;
$$;

comment on function contracts.in_force(uuid, text, date) is
  'The contracts of a participant that price a flow (offtake, injection) on a day, in the order of the cascade: by ascending priority.';

create or replace function contracts.price_at(p_contract_id uuid, p_component text, p_at timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  c      contracts.contracts%rowtype;
  s      contracts.price_signals%rowtype;
  idx    series%rowtype;
  v_idx  double precision;
  v      numeric;
begin
  select * into c from contracts.contracts where id = p_contract_id;
  if c.id is null then
    raise exception 'contract_not_found: %', p_contract_id using errcode = 'no_data_found';
  end if;
  select * into s from contracts.price_signals x
   where x.contract_id = c.id and x.component = p_component
     and x.valid_from <= p_at and (x.duration is null or x.valid_from + x.duration > p_at);
  if s.id is null then
    return null;
  end if;
  if s.form = 'fixed' then
    v := s.value;
  else
    idx := series_for_read(s.index_series_id);
    select sv.value into v_idx from series_values sv
     where sv.series_id = idx.id and sv.at <= p_at and (idx.step is null or sv.at > p_at - idx.step)
     order by sv.at desc limit 1;
    if v_idx is null then
      raise exception 'index_value_missing: series % has no value at %', idx.id, p_at using errcode = 'no_data_found';
    end if;
    v := s.factor * v_idx::numeric + s.value;
    v := greatest(v, coalesce(s.floor, v));
    v := least(v, coalesce(s.cap, v));
  end if;
  return jsonb_build_object(
    'price', v, 'unit', quantity_unit(p_component, c.currency), 'currency', c.currency,
    'signal_id', s.id, 'form', s.form, 'index', v_idx,
    'valid_from', s.valid_from, 'duration', s.duration);
end;
$$;

comment on function contracts.price_at(uuid, text, timestamptz) is
  'The price a contract sets for a component at an instant: the fixed value, or factor × the index series'' value at that instant + value within floor and cap, with its unit and currency, the signal and the index read. Null when no signal holds then; contract_not_found, series_not_found, index_value_missing by name.';

grant execute on function contracts.in_force(uuid, text, date) to authenticated, service_role;
grant execute on function contracts.price_at(uuid, text, timestamptz) to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('contracts', 'Contracts', '0.4.0', 'contracts', '0.4.0',
        'The contracts of a participant — supply, injection, physical or virtual PPA, internal tariff of a community, market — with the other party, the flow they price, their cascade and their prices as signals, fixed or indexed on a price series.');
