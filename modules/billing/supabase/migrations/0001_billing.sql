-- Nexgen OS — module `billing`: the bridge to the invoicing side.
--
-- Who a company or a person legally is, how to reach them and how they are
-- invoiced is kept by an invoicing application; Ekwo OS is the open one
-- built on the same playbook (decision 0010). The core names no
-- product and keeps no personal contact data: an organisation is a name, a
-- contact is a name and a kind, a participant names its contact. This
-- module keeps, beside them and keyed by the same ids, the Ekwo company an
-- organisation is, the Ekwo contact a contact is, the email and phone a
-- contact is reached at while it is not linked, and the Ekwo invoices
-- issued for or to a participant. It holds pointers, never an amount, a
-- currency, a tax, a VAT number, an IBAN or an invoice line: those are
-- Ekwo's.
--
-- One source for each fact. On a database holding both cores, what Ekwo OS
-- holds about a linked party is read from Ekwo OS, never copied here: its
-- legal numbers (`billing.legal_identifiers()`), how it is reached
-- (`billing.reach_of()`), the tax of an invoice (`billing.tax_of()`, by the
-- code the pack names beside the rate it keeps for simulation). Nexgen OS
-- holds its own only while the party is not linked, or Ekwo OS is not on
-- the database; linking moves the reach and the legal numbers to Ekwo OS's
-- side, and `nexgen-os doctor` names what is still held twice
-- (`billing_held_twice`).
--
-- When Ekwo OS shares the database — known by its own marker, its
-- `public.instance` table and `public.installed_schema_version()`, never by
-- a table name another application may use (`billing.ekwo_present()`) —
-- the Ekwo ids of this module take real foreign keys to its tables
-- (`billing.reference_ekwo()`, called by `nexgen-os init` and `migrate`, or
-- by hand once Ekwo OS is installed, never by this migration); when it does
-- not, they stay plain uuids and `nexgen-os doctor` names the rows whose
-- Ekwo id is gone (`billing_key_unlinked`).

set search_path = nexgen, extensions;

create schema billing;
grant usage on schema billing to authenticated, service_role;

create table billing.organisations (
  -- The organisation, by its own id.
  organisation_id  uuid primary key references organisations(id) on delete cascade,
  -- The company it is in Ekwo.
  ekwo_company_id  uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table billing.organisations is
  'The Ekwo company an organisation is: its legal identity and its invoices live there.';

create unique index organisations_one_ekwo_company on billing.organisations (ekwo_company_id);
create trigger billing_organisations_set_updated_at before update on billing.organisations
  for each row execute function set_updated_at();
call secure_table('billing.organisations');

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
-- Once the contact is linked to an Ekwo contact on the same database, its
-- email and phone are Ekwo's, and none is written here.
create or replace function billing.contacts_attach()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  select c.organisation_id into new.organisation_id from contacts c where c.id = new.id;
  if new.organisation_id is null then
    raise exception 'contact_not_found: %', new.id using errcode = 'foreign_key_violation';
  end if;
  if new.ekwo_contact_id is not null and (new.email is not null or new.phone is not null) and billing.ekwo_present()
     and (tg_op = 'INSERT' or new.email is distinct from old.email or new.phone is distinct from old.phone
          or new.ekwo_contact_id is distinct from old.ekwo_contact_id) then
    raise exception 'contact_reach_held_by_ekwo: contact % is linked to Ekwo contact %; its email and phone are written in Ekwo OS', new.id, new.ekwo_contact_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function billing.contacts_attach() is
  'BEFORE INSERT / UPDATE on billing.contacts: copies the organisation of the contact; refuses an email or a phone written on a contact linked to Ekwo OS on the same database (contact_reach_held_by_ekwo).';

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
  -- The settlement the amounts came from, by its id in the table of the
  -- module that computed it (`community.settlements` for a sharing); a
  -- module never names another module's table, so this is a plain id.
  settlement_id                   uuid,
  created_at                  timestamptz not null default now(),
  constraint invoices_kind check (kind in ('sale', 'purchase')),
  constraint invoices_period check (period_to >= period_from),
  constraint invoices_counterparty_not_self check (counterparty_participant_id is distinct from participant_id)
);

comment on table billing.invoices is
  'One row per Ekwo invoice issued for or to a participant of the core: the Ekwo id, the participant, the counterparty participant of a bill inside a community, sale or purchase, the period and the settlement. No amount, currency, status or line: Ekwo holds them.';

create index invoices_participant_idx on billing.invoices (participant_id, period_from);
create index invoices_counterparty_idx on billing.invoices (counterparty_participant_id) where counterparty_participant_id is not null;
create index invoices_settlement_idx on billing.invoices (settlement_id) where settlement_id is not null;
create index invoices_organisation_idx on billing.invoices (organisation_id);

-- The checks of parent_check() on the participant and the counterparty: an
-- invoice row copies the organisation of the participant and refuses a
-- counterparty of another organisation.
create or replace function billing.invoices_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_organisation uuid;
begin
  select p.organisation_id into v_organisation from participants p where p.id = new.participant_id;
  if v_organisation is null then
    raise exception 'participant_not_found: %', new.participant_id using errcode = 'foreign_key_violation';
  end if;
  new.organisation_id := v_organisation;
  if new.counterparty_participant_id is not null then
    select p.organisation_id into v_organisation from participants p where p.id = new.counterparty_participant_id;
    if v_organisation is null then
      raise exception 'participant_not_found: %', new.counterparty_participant_id using errcode = 'foreign_key_violation';
    end if;
    if v_organisation <> new.organisation_id then
      raise exception 'parent_in_other_organisation: counterparty_participant_id' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function billing.invoices_check() is
  'BEFORE INSERT / UPDATE on billing.invoices: copies the organisation of the participant (participant_not_found); the counterparty is of the same organisation.';

create trigger invoices_check before insert or update on billing.invoices
  for each row execute function billing.invoices_check();
call secure_table('billing.invoices', null, 'participant_id');

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- The tables of Ekwo OS, when it shares the database: read by name, so that
-- the module installs, and its functions run, without them.
-- Whether Ekwo OS shares the database: its own marker, the instance row's
-- table and the function that says its schema version. A database holding
-- another application's `public.contacts` or `public.documents` is not
-- Ekwo OS, and the module binds nothing to them.
create or replace function billing.ekwo_present()
returns boolean
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select to_regclass('public.instance') is not null
     and to_regprocedure('public.installed_schema_version()') is not null;
$$;

comment on function billing.ekwo_present() is
  'Whether Ekwo OS shares the database, by its own marker (public.instance and public.installed_schema_version()), never by a table name another application may use.';

create or replace function billing.ekwo_row_exists(p_table text, p_id uuid)
returns boolean
language plpgsql
stable
security invoker
-- Ekwo's tables are read under Ekwo's own search path: its policies call
-- its functions by their short names.
set search_path = public, pg_temp
as $$
declare
  v_found boolean;
begin
  if not billing.ekwo_present() or to_regclass(p_table) is null then
    return null;
  end if;
  execute format('select exists (select 1 from %s where id = $1)', p_table) into v_found using p_id;
  return v_found;
end;
$$;

comment on function billing.ekwo_row_exists(text, uuid) is
  'Whether a row of an Ekwo OS table (public.companies, public.contacts, public.documents) has this id; null when Ekwo OS does not share the database.';

-- ---------------------------------------------------------------------------
-- What Ekwo OS holds about a party, read where it is
-- ---------------------------------------------------------------------------

-- A legal number as two registers compare it: letters and digits only, upper
-- case, as Ekwo OS compares two parties it may merge. Not a check of its
-- digits, which is Ekwo OS's.
create or replace function billing.identifier_norm(p_value text)
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_value, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- The legal numbers Ekwo OS holds for a company or a contact: its
-- registration number under the ISO 6523 code its country names for a party
-- (`country_defaults.party_scheme`, set by Ekwo's pack), its VAT number under
-- the code of the VAT identifier (`vat_scheme`), and every other identifier
-- of its `identifiers`, keyed by the code of its scheme. The scheme is the
-- Nexgen OS scheme with that ISO 6523 code, or the key Ekwo names it by.
-- Read under Ekwo's row level security and its own search path; nothing
-- when Ekwo OS does not share the database.
create or replace function billing.ekwo_identifiers(p_table text, p_id uuid)
returns table (scheme text, icd text, value text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not billing.ekwo_present() or p_table not in ('public.companies', 'public.contacts') or to_regclass(p_table) is null then
    return;
  end if;
  return query execute format($q$
    with party as (
      select p.registration_number, p.vat_number, p.identifiers, cd.party_scheme, cd.vat_scheme
        from %s p
        left join public.country_defaults cd on cd.country = %s
       where p.id = $1
    ),
    found (key, icd, value) as (
      select null::text, party.party_scheme::text, party.registration_number::text from party where party.registration_number is not null
      union all
      select null::text, party.vat_scheme::text, party.vat_number::text from party where party.vat_number is not null
      union all
      select e.key, null::text, e.value from party, jsonb_each_text(party.identifiers) e
    )
    select coalesce(s.code, f.key), coalesce(f.icd, s.icd), f.value
      from found f
      left join nexgen.identifier_schemes s on (f.icd is not null and s.icd = f.icd) or (f.icd is null and s.code = f.key)$q$,
    p_table, case when p_table = 'public.companies' then 'coalesce(p.fiscal_country, p.country)' else 'p.country' end)
  using p_id;
end;
$$;

comment on function billing.ekwo_identifiers(text, uuid) is
  'The legal numbers Ekwo OS holds for a company (public.companies) or a contact (public.contacts): the registration number under its country''s party scheme, the VAT number under its VAT scheme (ISO 6523 codes of Ekwo''s country_defaults), and its identifiers by scheme; nothing when Ekwo OS does not share the database. Read under Ekwo''s row level security.';

-- The legal numbers of an organisation or a contact, from the one place
-- they are held: Ekwo OS when the party is linked to it on this database,
-- Nexgen OS otherwise — for an organisation, its identifiers under a scheme
-- with an ISO 6523 code; a contact of the core holds none.
create or replace function billing.legal_identifiers(p_object_kind text, p_object_id uuid)
returns table (scheme text, icd text, value text, held_by text)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_ekwo uuid;
begin
  if p_object_kind = 'organisation' then
    if not exists (select 1 from organisations where id = p_object_id) then
      raise exception 'organisation_not_found: %', p_object_id using errcode = 'no_data_found';
    end if;
    select b.ekwo_company_id into v_ekwo from billing.organisations b where b.organisation_id = p_object_id;
    if v_ekwo is not null and billing.ekwo_present() then
      return query select e.scheme, e.icd, e.value, 'ekwo'::text from billing.ekwo_identifiers('public.companies', v_ekwo) e order by 2, 1;
    else
      return query
        select i.scheme, s.icd, i.value, 'nexgen'::text
          from identifiers i join identifier_schemes s on s.code = i.scheme
         where i.object_kind = 'organisation' and i.object_id = p_object_id and s.icd is not null
           and (i.valid_to is null or i.valid_to > now())
         order by 2, 1;
    end if;
  elsif p_object_kind = 'contact' then
    if not exists (select 1 from contacts where id = p_object_id) then
      raise exception 'contact_not_found: %', p_object_id using errcode = 'no_data_found';
    end if;
    select b.ekwo_contact_id into v_ekwo from billing.contacts b where b.id = p_object_id;
    if v_ekwo is not null and billing.ekwo_present() then
      return query select e.scheme, e.icd, e.value, 'ekwo'::text from billing.ekwo_identifiers('public.contacts', v_ekwo) e order by 2, 1;
    end if;
  else
    raise exception 'kind_unknown: % (an organisation or a contact)', p_object_kind using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

comment on function billing.legal_identifiers(text, uuid) is
  'The legal numbers of an organisation or a contact — scheme, ISO 6523 code, value, and who holds them (ekwo or nexgen) — read from Ekwo OS when the party is linked to it on this database, from the identifiers of the organisation otherwise; never from both. Refuses organisation_not_found, contact_not_found, kind_unknown.';

-- The email and phone Ekwo OS holds for one of its contacts.
create or replace function billing.ekwo_reach(p_ekwo_contact_id uuid)
returns table (email text, phone text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not billing.ekwo_present() or to_regclass('public.contacts') is null then
    return;
  end if;
  return query execute 'select c.email::text, c.phone::text from public.contacts c where c.id = $1' using p_ekwo_contact_id;
end;
$$;

comment on function billing.ekwo_reach(uuid) is
  'The email and phone Ekwo OS holds for one of its contacts, under its row level security; nothing when Ekwo OS does not share the database.';

-- How a contact is reached, from the one place it is held: Ekwo OS once the
-- contact is linked to it on this database, this module otherwise.
create or replace function billing.reach_of(p_contact_id uuid)
returns table (email text, phone text, held_by text)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  b billing.contacts%rowtype;
begin
  if not exists (select 1 from contacts where id = p_contact_id) then
    raise exception 'contact_not_found: %', p_contact_id using errcode = 'no_data_found';
  end if;
  select * into b from billing.contacts c where c.id = p_contact_id;
  if b.ekwo_contact_id is not null and billing.ekwo_present() then
    return query select r.email, r.phone, 'ekwo'::text from billing.ekwo_reach(b.ekwo_contact_id) r;
  elsif b.id is not null then
    return query select b.email, b.phone, 'nexgen'::text;
  end if;
end;
$$;

comment on function billing.reach_of(uuid) is
  'The email and phone a contact is reached at, and who holds them: Ekwo OS once the contact is linked to it on this database (ekwo), this module while it is not (nexgen); no row when nothing is known. The one way to read how a contact is reached. Refuses contact_not_found.';

-- Ekwo's tax of a code for a company, and its percentage on a day.
create or replace function billing.ekwo_tax(p_company_id uuid, p_code text, p_on date)
returns table (id uuid, percent numeric)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not billing.ekwo_present() or to_regclass('public.taxes') is null then
    return;
  end if;
  return query execute 'select t.id, public.tax_rate_at(t.id, $3) from public.taxes t where t.company_id = $1 and t.code = $2'
    using p_company_id, p_code, p_on;
end;
$$;

comment on function billing.ekwo_tax(uuid, text, date) is
  'Ekwo OS''s tax of a code for a company, and its percentage on a day (its tax_rate_at()); nothing when Ekwo OS does not share the database.';

-- The tax of an invoice line for a participant on a day. The pack keeps,
-- for the place of the participant, a rate as a ratio for simulation
-- (`vat_rate_electricity`) and, beside it, the code of the tax it mirrors
-- in Ekwo OS (`vat_code_electricity`), read by the same cascade
-- (parameter_of()). When the organisation of the participant is an Ekwo
-- company on this database, the tax is Ekwo's tax of that code for the
-- company, at its rate on that day (Ekwo's `tax_rate_at()`); otherwise it
-- is the pack's rate, for a simulation.
create or replace function billing.tax_of(
  p_participant_id uuid,
  p_on             date,
  p_code_type      text default 'vat_code_electricity',
  p_rate_type      text default 'vat_rate_electricity'
)
returns table (tax_code text, rate numeric, ekwo_tax_id uuid, held_by text)
language plpgsql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_org     uuid;
  v_company uuid;
  v_code    text;
  v_tax     uuid;
  v_percent numeric;
begin
  select p.organisation_id into v_org from participants p where p.id = p_participant_id;
  if v_org is null then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  v_code := parameter_of('participant', p_participant_id, p_code_type, p_on::timestamptz)->>'value';
  if v_code is null then
    raise exception 'tax_code_missing: no % for participant %', p_code_type, p_participant_id using errcode = 'no_data_found';
  end if;
  select b.ekwo_company_id into v_company from billing.organisations b where b.organisation_id = v_org;
  if v_company is not null and billing.ekwo_present() then
    select t.id, t.percent into v_tax, v_percent from billing.ekwo_tax(v_company, v_code, p_on) t;
    if v_tax is null then
      raise exception 'ekwo_tax_not_found: Ekwo company % holds no tax %', v_company, v_code using errcode = 'no_data_found';
    end if;
    if v_percent is null then
      raise exception 'ekwo_tax_not_in_force: tax % of Ekwo company % on %', v_code, v_company, p_on using errcode = 'no_data_found';
    end if;
    return query select v_code, v_percent / 100, v_tax, 'ekwo'::text;
  else
    return query select v_code, (parameter_of('participant', p_participant_id, p_rate_type, p_on::timestamptz)->>'value')::numeric, null::uuid, 'nexgen'::text;
  end if;
end;
$$;

comment on function billing.tax_of(uuid, date, text, text) is
  'The tax of an invoice line for a participant on a day: the code its pack names beside the rate (vat_code_electricity), and the rate as a ratio — Ekwo OS''s tax of that code for the company of the organisation, at its rate on that day, when Ekwo OS shares the database (held_by ekwo, with its id); the pack''s rate, for a simulation, otherwise (held_by nexgen). Refuses participant_not_found, tax_code_missing, ekwo_tax_not_found, ekwo_tax_not_in_force.';

create or replace function billing.link_organisation(p_organisation_id uuid, p_ekwo_company_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_own record;
begin
  if not exists (select 1 from organisations where id = p_organisation_id) then
    raise exception 'organisation_not_found: %', p_organisation_id using errcode = 'no_data_found';
  end if;
  if billing.ekwo_row_exists('public.companies', p_ekwo_company_id) is false then
    raise exception 'ekwo_company_not_found: %', p_ekwo_company_id using errcode = 'foreign_key_violation';
  end if;
  -- On a shared database the legal numbers move to Ekwo OS: an identifier of
  -- the organisation under a scheme with an ISO 6523 code must be what the
  -- company holds under that code, and is then dropped; anything else is
  -- written in Ekwo OS first, where its check digits are validated.
  if billing.ekwo_present() then
    for v_own in
      select i.scheme, s.icd, i.value from identifiers i join identifier_schemes s on s.code = i.scheme
       where i.object_kind = 'organisation' and i.object_id = p_organisation_id and s.icd is not null
    loop
      if not exists (select 1 from billing.ekwo_identifiers('public.companies', p_ekwo_company_id) e
                      where e.icd = v_own.icd and billing.identifier_norm(e.value) = billing.identifier_norm(v_own.value)) then
        raise exception 'legal_identifier_conflict: % % (ISO 6523 %) is not what Ekwo company % holds; write it in Ekwo OS first',
          v_own.scheme, v_own.value, v_own.icd, p_ekwo_company_id using errcode = 'check_violation';
      end if;
      delete from identifiers i
       where i.object_kind = 'organisation' and i.object_id = p_organisation_id and i.scheme = v_own.scheme and i.value = v_own.value;
    end loop;
  end if;
  insert into billing.organisations (organisation_id, ekwo_company_id)
  values (p_organisation_id, p_ekwo_company_id)
  on conflict (organisation_id) do update set ekwo_company_id = excluded.ekwo_company_id;
end;
$$;

comment on function billing.link_organisation(uuid, uuid) is
  'Says which Ekwo company an organisation is; a second call changes it. On a database Ekwo OS shares, the legal numbers of the organisation (its identifiers under a scheme with an ISO 6523 code) move to Ekwo OS: dropped when the company holds the same, refused otherwise (legal_identifier_conflict). Refuses organisation_not_found and, when Ekwo OS shares the database, ekwo_company_not_found.';

create or replace function billing.link_contact(p_contact_id uuid, p_ekwo_contact_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_own    billing.contacts%rowtype;
  v_theirs record;
begin
  if not exists (select 1 from contacts where id = p_contact_id) then
    raise exception 'contact_not_found: %', p_contact_id using errcode = 'no_data_found';
  end if;
  if p_ekwo_contact_id is not null and billing.ekwo_row_exists('public.contacts', p_ekwo_contact_id) is false then
    raise exception 'ekwo_contact_not_found: %', p_ekwo_contact_id using errcode = 'foreign_key_violation';
  end if;
  select * into v_own from billing.contacts where id = p_contact_id;
  -- On a shared database the reach moves to Ekwo OS: what is kept here must
  -- be what Ekwo holds, and is then dropped; anything else is written in
  -- Ekwo OS first.
  if p_ekwo_contact_id is not null and billing.ekwo_present() and (v_own.email is not null or v_own.phone is not null) then
    select r.email, r.phone into v_theirs from billing.ekwo_reach(p_ekwo_contact_id) r;
    if v_own.email is not null and lower(v_own.email) is distinct from lower(v_theirs.email) then
      raise exception 'contact_reach_conflict: email % is not what Ekwo contact % holds (%); write it in Ekwo OS first',
        v_own.email, p_ekwo_contact_id, coalesce(v_theirs.email, 'none') using errcode = 'check_violation';
    end if;
    if v_own.phone is not null and v_own.phone is distinct from v_theirs.phone then
      raise exception 'contact_reach_conflict: phone % is not what Ekwo contact % holds (%); write it in Ekwo OS first',
        v_own.phone, p_ekwo_contact_id, coalesce(v_theirs.phone, 'none') using errcode = 'check_violation';
    end if;
    update billing.contacts set email = null, phone = null where id = p_contact_id;
  end if;
  insert into billing.contacts (id, ekwo_contact_id)
  values (p_contact_id, p_ekwo_contact_id)
  on conflict (id) do update set ekwo_contact_id = excluded.ekwo_contact_id;
end;
$$;

comment on function billing.link_contact(uuid, uuid) is
  'Says which Ekwo contact a contact of the core is; null unlinks it. On a database Ekwo OS shares, the email and phone kept here move to Ekwo OS: dropped when Ekwo holds the same, refused otherwise (contact_reach_conflict). Refuses contact_not_found and, when Ekwo OS shares the database, ekwo_contact_not_found.';

-- The taxes of the product lines of an Ekwo invoice.
create or replace function billing.ekwo_line_taxes(p_ekwo_invoice_id uuid)
returns table (line_id uuid, tax_id uuid)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not billing.ekwo_present() or to_regclass('public.document_lines') is null then
    return;
  end if;
  return query execute 'select l.id, l.tax_id from public.document_lines l where l.document_id = $1 and l.line_type::text = $2'
    using p_ekwo_invoice_id, 'product';
end;
$$;

comment on function billing.ekwo_line_taxes(uuid) is
  'The tax of each product line of an Ekwo invoice; nothing when Ekwo OS does not share the database.';

create or replace function billing.record_invoice(
  p_participant_id              uuid,
  p_ekwo_invoice_id             uuid,
  p_kind                        text,
  p_period_from                 date,
  p_period_to                   date,
  p_counterparty_participant_id uuid default null,
  p_settlement_id               uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_contact uuid;
  v_code    text;
  v_tax     uuid;
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
  -- An invoice of a settlement carries, on every product line, Ekwo's tax of
  -- the code the pack names for the participant: the tax is Ekwo's, by code.
  if p_settlement_id is not null and billing.ekwo_present() then
    select t.tax_code, t.ekwo_tax_id into v_code, v_tax from billing.tax_of(p_participant_id, p_period_to) t;
    if v_tax is not null and exists (
         select 1 from billing.ekwo_line_taxes(p_ekwo_invoice_id) l where l.tax_id is distinct from v_tax) then
      raise exception 'invoice_tax_mismatch: a line of Ekwo invoice % is not taxed by %, the tax of participant %',
        p_ekwo_invoice_id, v_code, p_participant_id using errcode = 'check_violation';
    end if;
  end if;
  begin
    insert into billing.invoices (id, participant_id, counterparty_participant_id, kind, period_from, period_to, settlement_id)
    values (p_ekwo_invoice_id, p_participant_id, p_counterparty_participant_id, p_kind, p_period_from, p_period_to, p_settlement_id);
  exception when unique_violation then
    raise exception 'invoice_already_recorded: %', p_ekwo_invoice_id using errcode = 'unique_violation';
  end;
  return p_ekwo_invoice_id;
end;
$$;

comment on function billing.record_invoice(uuid, uuid, text, date, date, uuid, uuid) is
  'Records that an Ekwo invoice was issued for or to a participant, over a period, from a settlement; returns its Ekwo id. Refuses participant_not_found, participant_contact_missing (a billed participant names its contact), invoice_already_recorded and, when Ekwo OS shares the database, ekwo_invoice_not_found and, for the invoice of a settlement, invoice_tax_mismatch (a product line not taxed by Ekwo''s tax of the code its pack names, billing.tax_of()). Issuing the invoice is not this function''s.';

create or replace function billing.invoices_of(p_participant_id uuid)
returns setof billing.invoices
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  select * from billing.invoices where participant_id = p_participant_id order by period_from, created_at, id;
$$;

comment on function billing.invoices_of(uuid) is
  'The Ekwo invoices of a participant, by period: what a page or an agent lists without knowing Ekwo; the amounts are read from Ekwo by the id.';

-- When Ekwo OS runs elsewhere, an Ekwo id would be checked through its API,
-- the Ekwo instance being a source with the name of its key (decision 0010).
-- This module does not reach another database, and refuses by name.
create or replace function billing.verify_remote_invoice(p_source_code text, p_ekwo_invoice_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  raise exception 'ekwo_remote_not_supported: % (this module does not reach an Ekwo OS on another database)', p_source_code
    using errcode = 'feature_not_supported';
end;
$$;

comment on function billing.verify_remote_invoice(text, uuid) is
  'Whether an Ekwo OS reached through its API, named by its source, holds this invoice. This module does not reach another database: raises ekwo_remote_not_supported.';

grant execute on function billing.identifier_norm(text), billing.ekwo_identifiers(text, uuid), billing.legal_identifiers(text, uuid),
  billing.ekwo_reach(uuid), billing.reach_of(uuid), billing.tax_of(uuid, date, text, text), billing.ekwo_tax(uuid, text, date),
  billing.ekwo_line_taxes(uuid)
  to authenticated, service_role;

grant execute on function billing.link_organisation(uuid, uuid), billing.link_contact(uuid, uuid),
  billing.record_invoice(uuid, uuid, text, date, date, uuid, uuid), billing.invoices_of(uuid),
  billing.ekwo_row_exists(text, uuid), billing.verify_remote_invoice(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The keys to Ekwo OS, when it shares the database
-- ---------------------------------------------------------------------------

-- Adds the foreign keys from the Ekwo ids of this module to the tables of
-- Ekwo OS that exist, when Ekwo OS shares the database (ekwo_present()),
-- and returns the names it added. Called by `nexgen-os init` and `migrate`
-- after the migrations, and by the installation (`select
-- billing.reference_ekwo()`) when Ekwo OS is installed after Nexgen OS.
-- Each key is added `not valid` and then validated: rows whose Ekwo id is
-- already gone keep the key unvalidated, and `nexgen-os doctor` names them.
-- When Ekwo removes the row, the link goes with it: the invoice row and the
-- company link are deleted, the contact keeps its email and phone.
create or replace function billing.reference_ekwo()
returns text[]
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k     record;
  added text[] := '{}';
begin
  if not billing.ekwo_present() then
    return added;
  end if;
  for k in
    select * from (values
      ('billing.organisations', 'organisations_ekwo_company_fk', 'ekwo_company_id', 'public.companies', 'cascade'),
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
  'Adds the foreign keys from the Ekwo ids of the module to public.companies, public.contacts and public.documents when Ekwo OS shares the database (ekwo_present()); returns the keys it added, none otherwise. Called by nexgen-os init and migrate, and by the installation after Ekwo OS is installed.';

-- The rows whose Ekwo id is not in Ekwo OS, when it shares the
-- database: what `nexgen-os doctor` reports as billing_key_unlinked.
create or replace function billing.unlinked_keys()
returns table (table_name text, id uuid, ekwo_id uuid)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not billing.ekwo_present() then
    return;
  end if;
  if to_regclass('public.companies') is not null then
    return query execute 'select ''billing.organisations'', b.organisation_id, b.ekwo_company_id from billing.organisations b
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

-- What is held on both sides for a party linked to Ekwo OS on this
-- database: an email or a phone of a linked contact (written before Ekwo OS
-- was installed beside it), a legal number of a linked organisation
-- (written after the link). What `nexgen-os doctor` reports as
-- billing_held_twice; `billing.link_contact()` and
-- `billing.link_organisation()`, called again, move them.
create or replace function billing.held_twice()
returns table (table_name text, id uuid, what text)
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if not billing.ekwo_present() then
    return;
  end if;
  return query
    select 'billing.contacts'::text, b.id,
           concat_ws(', ', case when b.email is not null then 'email' end, case when b.phone is not null then 'phone' end)
      from billing.contacts b
     where b.ekwo_contact_id is not null and (b.email is not null or b.phone is not null)
    union all
    select 'nexgen.identifiers'::text, i.object_id, i.scheme || ' ' || i.value
      from identifiers i
      join identifier_schemes s on s.code = i.scheme and s.icd is not null
      join billing.organisations o on o.organisation_id = i.object_id
     where i.object_kind = 'organisation';
end;
$$;

comment on function billing.held_twice() is
  'What is held both here and in Ekwo OS for a party linked to it on this database: the email or phone of a linked contact, a legal number (a scheme with an ISO 6523 code) of a linked organisation. Read by nexgen-os doctor (billing_held_twice).';

revoke execute on function billing.reference_ekwo(), billing.unlinked_keys(), billing.held_twice() from public;
grant execute on function billing.unlinked_keys(), billing.held_twice() to service_role;



insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('billing', 'Billing', '0.3.0', 'billing', '0.3.0',
        'The bridge to the invoicing side: the Ekwo company an organisation is, the Ekwo contact a contact is and how it is reached, and the Ekwo invoices issued for or to a participant.');
