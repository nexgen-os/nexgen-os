-- Nexgen OS — module `billing`: the bridge to the invoicing side.
--
-- Who a company or a person legally is, how to reach them and how they are
-- invoiced is kept by an invoicing application; Ekwo OS is the open one
-- built on the same playbook (decisions 0010 and 0043). The core names no
-- product and keeps no personal contact data: an organisation is a name, a
-- contact is a name and a kind, a participant names its contact. This
-- module keeps, beside them and keyed by the same ids, the Ekwo company an
-- organisation is, the Ekwo contact a contact is, the email and phone a
-- contact is reached at, and the Ekwo invoices issued for or to a
-- participant. It holds pointers, never an amount, a currency, a tax, a
-- VAT number, an IBAN or an invoice line: those are Ekwo's.
--
-- When Ekwo OS shares the database, the Ekwo ids of this module take real
-- foreign keys to its tables (`billing.reference_ekwo()`, at the end of this
-- file); when it does not, they stay plain uuids and `nexgen-os doctor`
-- names the rows whose Ekwo id is gone (`billing_key_unlinked`).

set search_path = nexgen, public, extensions;

create schema billing;
grant usage on schema billing to authenticated, service_role;

create table billing.companies (
  -- The organisation, by its own id.
  organisation_id  uuid primary key references organisations(id) on delete cascade,
  -- The company it is in Ekwo.
  ekwo_company_id  uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table billing.companies is
  'The Ekwo company an organisation is: its legal identity and its invoices live there.';

create unique index companies_one_ekwo_company on billing.companies (ekwo_company_id);
create trigger billing_companies_set_updated_at before update on billing.companies
  for each row execute function set_updated_at();
call secure_table('billing.companies');

create table billing.contacts (
  -- The contact, by its own id.
  id               uuid primary key references contacts(id) on delete cascade,
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- The contact it is in Ekwo. Null until linked.
  ekwo_contact_id  uuid,
  email            text,
  phone            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contacts_email_format check (email is null or email ~ '^[^@\s]+@[^@\s]+$')
);

comment on table billing.contacts is
  'How a contact is reached and which Ekwo contact it is: email, phone, Ekwo id. Personal data, kept where the invoicing side manages it.';

-- The organisation is the contact's: copied, never chosen.
create or replace function billing.contacts_attach()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  select c.organisation_id into new.organisation_id from contacts c where c.id = new.id;
  if new.organisation_id is null then
    raise exception 'contact_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

comment on function billing.contacts_attach() is
  'BEFORE INSERT / UPDATE on billing.contacts: copies the organisation of the contact.';

create trigger contacts_attach before insert or update on billing.contacts
  for each row execute function billing.contacts_attach();
create trigger billing_contacts_set_updated_at before update on billing.contacts
  for each row execute function set_updated_at();
call secure_table('billing.contacts');


-- ---------------------------------------------------------------------------
-- invoices — the Ekwo invoices issued for or to a participant.
-- ---------------------------------------------------------------------------

create table billing.invoices (
  -- The invoice it is in Ekwo: its id there is the key here.
  id                          uuid primary key,
  -- Copied from the participant by trigger.
  organisation_id             uuid not null references organisations(id) on delete cascade,
  -- The participant who is billed; its billing contact is its own contact_id.
  participant_id              uuid not null references participants(id),
  -- The other participant of a bill between two participants of a community.
  counterparty_participant_id uuid references participants(id),
  -- From the participant's point of view: it sells (`sale`) or buys (`purchase`).
  kind                        text not null,
  -- The first and the last day the invoice covers.
  period_from                 date not null,
  period_to                   date not null,
  -- The settlement run the amounts came from.
  run_id                      uuid references runs(id) on delete set null,
  created_at                  timestamptz not null default now(),
  constraint invoices_kind check (kind in ('sale', 'purchase')),
  constraint invoices_period check (period_to >= period_from),
  constraint invoices_counterparty_not_self check (counterparty_participant_id is distinct from participant_id)
);

comment on table billing.invoices is
  'One row per Ekwo invoice issued for or to a participant of the core: the Ekwo id, the participant, the counterparty participant of a bill inside a community, sale or purchase, the period and the settlement run. No amount, currency, status or line: Ekwo holds them.';

create index invoices_participant_idx on billing.invoices (participant_id, period_from);
create index invoices_counterparty_idx on billing.invoices (counterparty_participant_id) where counterparty_participant_id is not null;
create index invoices_run_idx on billing.invoices (run_id) where run_id is not null;
create index invoices_organisation_idx on billing.invoices (organisation_id);

-- The checks of parent_check() on the participant, the counterparty and the
-- run: an invoice row is not a kind of object and has no scenario,
-- so it copies the organisation of the participant and refuses a parent of
-- another organisation or one that exists only in a scenario.
create or replace function billing.invoices_check()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_organisation uuid;
  v_scenario     uuid;
begin
  select p.organisation_id, p.scenario_id into v_organisation, v_scenario from participants p where p.id = new.participant_id;
  if v_organisation is null then
    raise exception 'participant_not_found: %', new.participant_id using errcode = 'foreign_key_violation';
  end if;
  if v_scenario is not null then
    raise exception 'parent_in_other_scenario: participant_id' using errcode = 'check_violation';
  end if;
  new.organisation_id := v_organisation;
  if new.counterparty_participant_id is not null then
    select p.organisation_id, p.scenario_id into v_organisation, v_scenario from participants p where p.id = new.counterparty_participant_id;
    if v_organisation is null then
      raise exception 'participant_not_found: %', new.counterparty_participant_id using errcode = 'foreign_key_violation';
    end if;
    if v_organisation <> new.organisation_id then
      raise exception 'parent_in_other_organisation: counterparty_participant_id' using errcode = 'check_violation';
    end if;
    if v_scenario is not null then
      raise exception 'parent_in_other_scenario: counterparty_participant_id' using errcode = 'check_violation';
    end if;
  end if;
  if new.run_id is not null and (select r.organisation_id from runs r where r.id = new.run_id) is distinct from new.organisation_id then
    raise exception 'parent_in_other_organisation: run_id' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function billing.invoices_check() is
  'BEFORE INSERT / UPDATE on billing.invoices: copies the organisation of the participant (participant_not_found); the counterparty and the run are of the same organisation, and neither participant exists only in a scenario.';

create trigger invoices_check before insert or update on billing.invoices
  for each row execute function billing.invoices_check();
call secure_table('billing.invoices');

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- The tables of Ekwo OS, when it shares the database: read by name, so that
-- the module installs, and its functions run, without them.
create or replace function billing.ekwo_row_exists(p_table text, p_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_found boolean;
begin
  if to_regclass(p_table) is null then
    return null;
  end if;
  execute format('select exists (select 1 from %s where id = $1)', p_table) into v_found using p_id;
  return v_found;
end;
$$;

comment on function billing.ekwo_row_exists(text, uuid) is
  'Whether a row of an Ekwo OS table (public.companies, public.contacts, public.documents) has this id; null when Ekwo OS does not share the database.';

create or replace function billing.link_company(p_organisation_id uuid, p_ekwo_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from organisations where id = p_organisation_id) then
    raise exception 'organisation_not_found: %', p_organisation_id using errcode = 'no_data_found';
  end if;
  if billing.ekwo_row_exists('public.companies', p_ekwo_company_id) is false then
    raise exception 'ekwo_company_not_found: %', p_ekwo_company_id using errcode = 'foreign_key_violation';
  end if;
  insert into billing.companies (organisation_id, ekwo_company_id)
  values (p_organisation_id, p_ekwo_company_id)
  on conflict (organisation_id) do update set ekwo_company_id = excluded.ekwo_company_id;
end;
$$;

comment on function billing.link_company(uuid, uuid) is
  'Says which Ekwo company an organisation is; a second call changes it. Refuses organisation_not_found and, when Ekwo OS shares the database, ekwo_company_not_found.';

create or replace function billing.link_contact(p_contact_id uuid, p_ekwo_contact_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from contacts where id = p_contact_id) then
    raise exception 'contact_not_found: %', p_contact_id using errcode = 'no_data_found';
  end if;
  if p_ekwo_contact_id is not null and billing.ekwo_row_exists('public.contacts', p_ekwo_contact_id) is false then
    raise exception 'ekwo_contact_not_found: %', p_ekwo_contact_id using errcode = 'foreign_key_violation';
  end if;
  insert into billing.contacts (id, ekwo_contact_id)
  values (p_contact_id, p_ekwo_contact_id)
  on conflict (id) do update set ekwo_contact_id = excluded.ekwo_contact_id;
end;
$$;

comment on function billing.link_contact(uuid, uuid) is
  'Says which Ekwo contact a contact of the core is, keeping its email and phone; null unlinks it. Refuses contact_not_found and, when Ekwo OS shares the database, ekwo_contact_not_found.';

create or replace function billing.record_invoice(
  p_participant_id              uuid,
  p_ekwo_invoice_id             uuid,
  p_kind                        text,
  p_period_from                 date,
  p_period_to                   date,
  p_counterparty_participant_id uuid default null,
  p_run_id                      uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_contact uuid;
begin
  select p.contact_id into v_contact from participants p where p.id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  if v_contact is null then
    raise exception 'participant_contact_missing: %', p_participant_id using errcode = 'check_violation';
  end if;
  if billing.ekwo_row_exists('public.documents', p_ekwo_invoice_id) is false then
    raise exception 'ekwo_invoice_not_found: %', p_ekwo_invoice_id using errcode = 'foreign_key_violation';
  end if;
  begin
    insert into billing.invoices (id, participant_id, counterparty_participant_id, kind, period_from, period_to, run_id)
    values (p_ekwo_invoice_id, p_participant_id, p_counterparty_participant_id, p_kind, p_period_from, p_period_to, p_run_id);
  exception when unique_violation then
    raise exception 'invoice_already_recorded: %', p_ekwo_invoice_id using errcode = 'unique_violation';
  end;
  return p_ekwo_invoice_id;
end;
$$;

comment on function billing.record_invoice(uuid, uuid, text, date, date, uuid, uuid) is
  'Records that an Ekwo invoice was issued for or to a participant, over a period, from a settlement run; returns its Ekwo id. Refuses participant_not_found, participant_contact_missing (a billed participant names its contact), invoice_already_recorded and, when Ekwo OS shares the database, ekwo_invoice_not_found. Issuing the invoice is not this function''s.';

create or replace function billing.invoices_of(p_participant_id uuid)
returns setof billing.invoices
language sql
stable
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
  select * from billing.invoices where participant_id = p_participant_id order by period_from, created_at, id;
$$;

comment on function billing.invoices_of(uuid) is
  'The Ekwo invoices of a participant, by period: what a page or an agent lists without knowing Ekwo; the amounts are read from Ekwo by the id.';

-- When Ekwo OS runs elsewhere, the same gestures check the Ekwo id through
-- its API, the Ekwo instance being a source with the name of its key
-- (decision 0010). That path is the invoicing bridge of the contracts
-- module, which completes this function; until then it refuses by name.
create or replace function billing.verify_remote_invoice(p_source_code text, p_ekwo_invoice_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  raise exception 'ekwo_remote_not_supported: % (an Ekwo OS on another database is reached by the invoicing bridge of the contracts module)', p_source_code
    using errcode = 'feature_not_supported';
end;
$$;

comment on function billing.verify_remote_invoice(text, uuid) is
  'Whether an Ekwo OS reached through its API, named by its source, holds this invoice. Not supported yet: raises ekwo_remote_not_supported; the invoicing bridge of the contracts module completes it.';

grant execute on function billing.link_company(uuid, uuid), billing.link_contact(uuid, uuid),
  billing.record_invoice(uuid, uuid, text, date, date, uuid, uuid), billing.invoices_of(uuid),
  billing.ekwo_row_exists(text, uuid), billing.verify_remote_invoice(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The keys to Ekwo OS, when it shares the database
-- ---------------------------------------------------------------------------

-- Adds the foreign keys from the Ekwo ids of this module to the tables of
-- Ekwo OS that exist, and returns the names it added. Run at the end of
-- this migration, and again by the installation (`select
-- billing.reference_ekwo()`) when Ekwo OS is installed after Nexgen OS.
-- Each key is added `not valid` and then validated: rows whose Ekwo id is
-- already gone keep the key unvalidated, and `nexgen-os doctor` names them.
-- When Ekwo removes the row, the link goes with it: the invoice row and the
-- company link are deleted, the contact keeps its email and phone.
create or replace function billing.reference_ekwo()
returns text[]
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  k     record;
  added text[] := '{}';
begin
  for k in
    select * from (values
      ('billing.companies', 'companies_ekwo_company_fk', 'ekwo_company_id', 'public.companies', 'cascade'),
      ('billing.contacts', 'contacts_ekwo_contact_fk', 'ekwo_contact_id', 'public.contacts', 'set null'),
      ('billing.invoices', 'invoices_ekwo_invoice_fk', 'id', 'public.documents', 'cascade')
    ) as t (tbl, name, col, target, on_delete)
  loop
    continue when to_regclass(k.target) is null
      or exists (select 1 from pg_constraint where conrelid = k.tbl::regclass and conname = k.name);
    execute format('alter table %s add constraint %I foreign key (%I) references %s (id) on delete %s not valid',
                   k.tbl, k.name, k.col, k.target, k.on_delete);
    begin
      execute format('alter table %s validate constraint %I', k.tbl, k.name);
    exception when foreign_key_violation then
      null;
    end;
    added := added || k.name;
  end loop;
  return added;
end;
$$;

comment on function billing.reference_ekwo() is
  'Adds the foreign keys from the Ekwo ids of the module to public.companies, public.contacts and public.documents when Ekwo OS shares the database; returns the keys it added. Run by the installation, again after Ekwo OS is installed.';

-- The rows whose Ekwo id is no longer in Ekwo OS, when it shares the
-- database: what `nexgen-os doctor` reports as billing_key_unlinked.
create or replace function billing.unlinked_keys()
returns table (table_name text, id uuid, ekwo_id uuid)
language plpgsql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if to_regclass('public.companies') is not null then
    return query execute 'select ''billing.companies'', b.organisation_id, b.ekwo_company_id from billing.companies b
                           where not exists (select 1 from public.companies e where e.id = b.ekwo_company_id)';
  end if;
  if to_regclass('public.contacts') is not null then
    return query execute 'select ''billing.contacts'', b.id, b.ekwo_contact_id from billing.contacts b
                           where b.ekwo_contact_id is not null and not exists (select 1 from public.contacts e where e.id = b.ekwo_contact_id)';
  end if;
  if to_regclass('public.documents') is not null then
    return query execute 'select ''billing.invoices'', b.id, b.id from billing.invoices b
                           where not exists (select 1 from public.documents e where e.id = b.id)';
  end if;
end;
$$;

comment on function billing.unlinked_keys() is
  'The rows of the module whose Ekwo id is not in Ekwo OS, when Ekwo OS shares the database: table, row id, Ekwo id. Read by nexgen-os doctor (billing_key_unlinked).';

revoke execute on function billing.reference_ekwo(), billing.unlinked_keys() from public;
grant execute on function billing.unlinked_keys() to service_role;

select billing.reference_ekwo();

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('billing', 'Billing', '0.2.0', 'billing', '0.3.0',
        'The bridge to the invoicing side: the Ekwo company an organisation is, the Ekwo contact a contact is and how it is reached, and the Ekwo invoices issued for or to a participant.');
