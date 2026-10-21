-- Nexgen OS — core: organisations, their members and their contacts.
--
-- An organisation is whoever owns a body of descriptions: an architecture
-- firm, a municipality, a housing company, an installer, a family. Every row
-- of the core carries the `organisation_id` it belongs to, and row level
-- security is driven by `organisation_members`. One installation may hold
-- many organisations. An organisation is also an object of the registry
-- (`20261012200900_core_object_kinds_rls.sql`), so that attributes,
-- identifiers, links and documents attach to it as to anything else.
--
-- Who a company or a person legally is — legal form, registration number,
-- tax number, postal and electronic addresses, bank details — is not
-- modelled here. An invoicing application keeps it; the `billing` module is
-- the bridge to one (decision 0010).

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
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organisations_name_not_blank check (btrim(name) <> '')
);

comment on table organisations is
  'Owner of a body of descriptions: a firm, a municipality, an installer, a family. Every core row belongs to exactly one organisation. An object itself: attributes, identifiers, links and documents attach to it.';

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
  'Who may read or write an organisation. `owner` administers, `editor` writes, `viewer` reads. An agent acting for a person is that person. An organisation always keeps an owner.';

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

comment on function organisation_role(uuid) is
  'The role of the signed-in user in an organisation, null when not a member.';

create or replace function can_read_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select organisation_role(p_organisation_id) is not null;
$$;

comment on function can_read_organisation(uuid) is
  'True when the signed-in user is a member of the organisation.';

create or replace function can_write_organisation(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce(organisation_role(p_organisation_id) in ('owner', 'editor'), false);
$$;

comment on function can_write_organisation(uuid) is
  'True when the signed-in user is an owner or an editor of the organisation.';

create or replace function is_organisation_owner(p_organisation_id uuid)
returns boolean
language sql
stable
set search_path = nexgen, public, extensions, pg_temp
as $$
  select coalesce(organisation_role(p_organisation_id) = 'owner', false);
$$;

comment on function is_organisation_owner(uuid) is
  'True when the signed-in user owns the organisation.';

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

comment on function organisations_add_creator() is
  'AFTER INSERT on organisations: the signed-in creator becomes its owner.';

create trigger organisations_add_creator
  after insert on organisations
  for each row execute function organisations_add_creator();

-- An organisation never loses its last owner: nobody could administer it
-- again. Removing the organisation itself removes its members with it.
create or replace function organisation_members_keep_owner()
returns trigger
language plpgsql
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.organisation_id <> old.organisation_id)
     and exists (select 1 from organisations o where o.id = old.organisation_id)
     and not exists (select 1 from organisation_members m
                      where m.organisation_id = old.organisation_id and m.role = 'owner' and m.user_id <> old.user_id) then
    raise exception 'last_owner: the organisation % would have no owner left', old.organisation_id
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function organisation_members_keep_owner() is
  'BEFORE UPDATE / DELETE on organisation_members: refuses, as last_owner, a change that leaves an organisation without an owner.';

create trigger organisation_members_keep_owner
  before update or delete on organisation_members
  for each row execute function organisation_members_keep_owner();

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

comment on procedure secure_table(text) is
  'Row level security by organisation on a table that carries organisation_id: members read, owners and editors write.';

-- ---------------------------------------------------------------------------
-- contacts — the people and companies an organisation deals with.
-- ---------------------------------------------------------------------------

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Display name. The legal name, numbers and addresses are kept by the
  -- application that invoices them (the `billing` module links to it).
  name             text not null,
  kind             text not null default 'company',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contacts_name_not_blank check (btrim(name) <> ''),
  constraint contacts_kind check (kind in ('person', 'company'))
);

comment on table contacts is
  'A person or a company the organisation deals with: an owner, a tenant, an installer, a grid operator. A name and a kind; how to reach and invoice them is the invoicing side''s (the billing module).';

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

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- The id is drawn before the insert: the new row becomes readable only once
-- the creator's membership exists, so nothing is read back.
create or replace function create_organisation(p_name text)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into organisations (id, name) values (v_id, p_name);
  return v_id;
end;
$$;

comment on function create_organisation(text) is
  'Creates an organisation; the signed-in user becomes its owner. Returns its id.';

create or replace function add_member(p_organisation_id uuid, p_user_id uuid, p_role member_role default 'viewer')
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  insert into organisation_members (organisation_id, user_id, role)
  values (p_organisation_id, p_user_id, p_role);
exception when unique_violation then
  raise exception 'already_member: % is already a member of %', p_user_id, p_organisation_id
    using errcode = 'unique_violation';
end;
$$;

comment on function add_member(uuid, uuid, member_role) is
  'Gives a person a role in an organisation. Owners only (row level security); already_member when they have one.';

create or replace function set_member_role(p_organisation_id uuid, p_user_id uuid, p_role member_role)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  update organisation_members set role = p_role
   where organisation_id = p_organisation_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found: % in %', p_user_id, p_organisation_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function set_member_role(uuid, uuid, member_role) is
  'Changes a member''s role. Owners only; last_owner when the organisation would lose its last owner.';

create or replace function remove_member(p_organisation_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  delete from organisation_members where organisation_id = p_organisation_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found: % in %', p_user_id, p_organisation_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function remove_member(uuid, uuid) is
  'Removes a member. Owners only; last_owner when it is the last owner.';

grant execute on function create_organisation(text), add_member(uuid, uuid, member_role),
  set_member_role(uuid, uuid, member_role), remove_member(uuid, uuid) to authenticated, service_role;
