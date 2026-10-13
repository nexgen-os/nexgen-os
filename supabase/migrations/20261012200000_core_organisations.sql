-- Nexgen OS — core: organisations, their members and their contacts.
--
-- An organisation is whoever owns a body of descriptions: an architecture
-- firm, a municipality, a housing company, an installer, a family. Every row
-- of the core carries the `organisation_id` it belongs to, and row level
-- security is driven by `organisation_members`. One installation may hold
-- many organisations.
--
-- Who a company or a person legally is — legal form, registration number,
-- VAT number, address, bank details — is not re-modelled here. These are
-- objects of Ekwo OS, the open-source accounting core built on the same
-- playbook: an organisation and a contact keep the Ekwo id they are known by,
-- and Ekwo is the one place that knows them and invoices them.

-- The core lives in its own schema, as every module does (decision 0010):
-- `public` stays the installation's, and Ekwo OS or any other application
-- can share the database. A connection reads it with `nexgen` on its
-- search path; on PostgREST the schema is exposed and named by the client.
create schema if not exists nexgen;
grant usage on schema nexgen to authenticated, service_role;
set search_path = nexgen, public, extensions;

-- Geometry lives in PostGIS. On a hosted Supabase project the extension is
-- already available; on a bare Postgres it has to be installed beforehand.
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Generic BEFORE UPDATE trigger keeping updated_at honest.';

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'editor', 'viewer');

create table organisations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  -- The company this organisation is, in Ekwo. Null until linked.
  ekwo_company_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organisations_name_not_blank check (btrim(name) <> '')
);

comment on table organisations is
  'Owner of a body of descriptions: a firm, a municipality, an installer, a family. Every core row belongs to exactly one organisation. Its legal identity is its Ekwo company.';

create trigger organisations_set_updated_at
  before update on organisations
  for each row execute function set_updated_at();

create table organisation_members (
  organisation_id uuid not null references organisations(id) on delete cascade,
  user_id         uuid not null,
  role            member_role not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

comment on table organisation_members is
  'Who may read or write an organisation. `owner` administers, `editor` writes, `viewer` reads. An agent acting for a person is that person.';

create index organisation_members_user_id_idx on organisation_members (user_id);

create trigger organisation_members_set_updated_at
  before update on organisation_members
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- SECURITY DEFINER so that the policy on `organisation_members` itself does
-- not recurse into the table it protects.
-- ---------------------------------------------------------------------------

create or replace function organisation_role(p_organisation_id uuid)
returns member_role
language sql
stable
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
  select m.role
    from organisation_members m
   where m.organisation_id = p_organisation_id
     and m.user_id = auth.uid();
$$;

create or replace function can_read_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select organisation_role(p_organisation_id) is not null;
$$;

create or replace function can_write_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select organisation_role(p_organisation_id) in ('owner', 'editor');
$$;

create or replace function is_organisation_owner(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select organisation_role(p_organisation_id) = 'owner';
$$;

-- Whoever creates an organisation owns it. Without this, the creator could
-- not read the row they just inserted.
create or replace function organisations_add_creator()
returns trigger
language plpgsql
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if auth.uid() is not null then
    insert into organisation_members (organisation_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger organisations_add_creator
  after insert on organisations
  for each row execute function organisations_add_creator();

-- Applies the standard policies to a table that carries organisation_id:
-- members read, owners and editors write. The table may be schema-qualified
-- (a module's); policy names are derived from it.
create or replace procedure secure_table(p_table text)
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  n text := replace(p_table, '.', '_');
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy %I on %s for select to authenticated using (can_read_organisation(organisation_id))', n || '_select', p_table);
  execute format('create policy %I on %s for all to authenticated using (can_write_organisation(organisation_id)) with check (can_write_organisation(organisation_id))', n || '_write', p_table);
  execute format('grant select, insert, update, delete on %s to authenticated, service_role', p_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- contacts — the people and companies an organisation deals with.
-- ---------------------------------------------------------------------------

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Display name. The legal name, form, numbers and addresses are Ekwo's.
  name             text not null,
  kind             text not null default 'company',
  email            text,
  phone            text,
  -- The Ekwo contact this is. Null until linked.
  ekwo_contact_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contacts_name_not_blank check (btrim(name) <> ''),
  constraint contacts_kind check (kind in ('person', 'company'))
);

comment on table contacts is
  'A person or a company the organisation deals with: an owner, a tenant, an installer, a grid operator. Who it legally is, and how it is invoiced, lives in Ekwo; this row keeps the Ekwo id and a display name.';

create index contacts_organisation_idx on contacts (organisation_id);

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table organisations enable row level security;
alter table organisation_members enable row level security;

create policy organisations_select on organisations
  for select to authenticated using (can_read_organisation(id));
create policy organisations_insert on organisations
  for insert to authenticated with check (auth.uid() is not null);
create policy organisations_update on organisations
  for update to authenticated using (is_organisation_owner(id)) with check (is_organisation_owner(id));
create policy organisations_delete on organisations
  for delete to authenticated using (is_organisation_owner(id));

create policy organisation_members_select on organisation_members
  for select to authenticated using (can_read_organisation(organisation_id));
create policy organisation_members_write on organisation_members
  for all to authenticated
  using (is_organisation_owner(organisation_id))
  with check (is_organisation_owner(organisation_id));

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on organisations, organisation_members to authenticated, service_role;
grant execute on function organisation_role(uuid), can_read_organisation(uuid),
  can_write_organisation(uuid), is_organisation_owner(uuid) to authenticated, service_role;

call secure_table('contacts');
