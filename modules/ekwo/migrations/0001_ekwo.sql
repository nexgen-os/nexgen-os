-- Nexgen OS — module `ekwo`: the bridge to the accounting side.
--
-- Who a company or a person legally is, how to reach them and how they are
-- invoiced is kept by an accounting application; Ekwo OS is the open one
-- built on the same playbook (decision 0010). The core names no product and
-- keeps no personal contact data: an organisation is a name, a contact is a
-- name and a kind. This module keeps, beside them and keyed by the same
-- ids, the Ekwo company an organisation is, the Ekwo contact a contact is,
-- and the email and phone a contact is reached at.

set search_path = nexgen, public, extensions;

create schema ekwo;
grant usage on schema ekwo to authenticated, service_role;

create table ekwo.companies (
  -- The organisation, by its own id.
  organisation_id  uuid primary key references organisations(id) on delete cascade,
  -- The company it is in Ekwo.
  ekwo_company_id  uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table ekwo.companies is
  'The Ekwo company an organisation is: its legal identity and its invoices live there.';

create unique index companies_one_ekwo_company on ekwo.companies (ekwo_company_id);
create trigger ekwo_companies_set_updated_at before update on ekwo.companies
  for each row execute function set_updated_at();
call secure_table('ekwo.companies');

create table ekwo.contacts (
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

comment on table ekwo.contacts is
  'How a contact is reached and which Ekwo contact it is: email, phone, Ekwo id. Personal data, kept where the accounting side manages it.';

-- The organisation is the contact's: copied, never chosen.
create or replace function ekwo.contacts_attach()
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

comment on function ekwo.contacts_attach() is
  'BEFORE INSERT / UPDATE on ekwo.contacts: copies the organisation of the contact.';

create trigger contacts_attach before insert or update on ekwo.contacts
  for each row execute function ekwo.contacts_attach();
create trigger ekwo_contacts_set_updated_at before update on ekwo.contacts
  for each row execute function set_updated_at();
call secure_table('ekwo.contacts');

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('ekwo', 'Ekwo', '0.1.0', 'ekwo', '0.2.0',
        'The bridge to the accounting side: the Ekwo company an organisation is, the Ekwo contact a contact is, and how a contact is reached.');
