-- Nexgen OS — core: organisations, their members and their contacts.
--
-- An organisation is whoever owns a body of descriptions: a design office,
-- a municipality, a housing company, an installer, a family. Every row
-- of the core carries the `organisation_id` it belongs to, and row level
-- security is driven by `organisation_members`. One installation may hold
-- many organisations. An organisation is also a kind of object
-- (`organisation`), so that attributes, identifiers, documents and series
-- attach to it as to any object of the core.
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
set search_path = nexgen, extensions;

-- Geometry lives in PostGIS. On a hosted Supabase project the extension is
-- already available; on a bare Postgres it has to be installed beforehand.
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
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
-- Capabilities — what a policy tests (decision 0051)
--
-- A role is a preset; a capability is what a policy or a gesture asks for.
-- `capabilities` names everything a person may be allowed to do, one code
-- per thing, `role_capabilities` says what each preset holds, and
-- `has_capability()` is the one question every policy of the core and of
-- the modules asks. No policy compares a role. The shape and the words are
-- those of Ekwo OS, so that a person who administers both reads one model.
--
-- A preset is resolved from where the person stands towards an object:
--
--   * a member of its organisation (`organisation_members.role`: owner,
--     editor, viewer) holds the preset of that role on everything of the
--     organisation;
--   * a person a project is shared with (`project_shares.role`: editor,
--     viewer) holds the preset of that role on the project and everything
--     under it, and nothing of the organisation itself;
--   * the account of a participant (`participants.user_id`) holds the
--     preset `participant` on that participant and on the participants it
--     groups, and on everything under them: its meters, devices, series,
--     estimates, bills and actions. Nothing of the other participants of
--     the project, nothing of the project or of the organisation.
--
-- A module adds its own codes with `area` set to its code, and its rows to
-- `role_capabilities`.
-- ---------------------------------------------------------------------------

create table capabilities (
  code        text primary key,
  area        text not null,
  description text not null,
  constraint capabilities_code_shape check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

comment on table capabilities is
  'Everything a person may be allowed to do, one row per code, as Ekwo OS names them. Seeded by the core; a module adds its own with area set to the module code.';
comment on column capabilities.area is
  'What the code belongs to: a family of the core, or the code of a module.';

-- Every code is read by a policy or by a gesture.
insert into capabilities (code, area, description) values
  ('data.read',             'data',         'Read the descriptions: projects, participants, meters, devices, series, attachments and what the modules computed about them.'),
  ('data.write',            'data',         'Describe, attach, import and compute: write the projects, participants, meters, devices, series, attachments and module rows.'),
  ('shares.manage',         'shares',       'Share a project with a person outside the organisation, invite an editor or a viewer, and open the account of a participant.'),
  ('members.manage',        'members',      'Give, change and remove the roles of the organisation, invite an owner, issue and withdraw machine keys.'),
  ('organisation.write',    'organisation', 'Rename or delete the organisation itself.'),
  ('account.contact',       'account',      'Change the contact details of a participant: the attribute types written with this capability.'),
  ('account.consent',       'account',      'Give and withdraw the consents of a participant.'),
  ('account.notifications', 'account',      'Choose how a participant is notified: the attribute types written with this capability.'),
  ('account.decide',        'account',      'Validate or dismiss a recommendation made to a participant.');

create table role_capabilities (
  role       text not null,
  capability text not null references capabilities(code) on delete cascade,
  primary key (role, capability),
  constraint role_capabilities_role_format check (role ~ '^[a-z][a-z_]*$')
);

comment on table role_capabilities is
  'What each preset holds: owner, editor and viewer of an organisation or of a project shared with a person, and participant for the account of a participant. A role is never tested by a policy; it is resolved here into capabilities.';

-- The presets keep exactly what each role could do before capabilities:
-- a viewer reads, an editor writes and shares, an owner also administers
-- the organisation, its members and its keys. The account of a participant
-- reads its own and makes the few choices that are its own.
insert into role_capabilities (role, capability)
select 'viewer', code from capabilities where code = 'data.read';
insert into role_capabilities (role, capability)
select 'editor', code from capabilities where code not in ('members.manage', 'organisation.write');
insert into role_capabilities (role, capability)
select 'owner', code from capabilities;
insert into role_capabilities (role, capability)
select 'participant', code from capabilities where code = 'data.read' or area = 'account';

alter table capabilities enable row level security;
alter table role_capabilities enable row level security;
create policy capabilities_select on capabilities for select to authenticated using (true);
create policy role_capabilities_select on role_capabilities for select to authenticated using (true);
grant select on capabilities, role_capabilities to authenticated, service_role;
grant insert, update, delete on capabilities, role_capabilities to service_role;

-- The role of the signed-in user in an organisation, for a page that shows
-- which preset a person is on. No policy reads it.
create or replace function organisation_role(p_organisation_id uuid)
returns member_role
language sql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
  select m.role
    from organisation_members m
   where m.organisation_id = p_organisation_id
     and m.user_id = auth.uid();
$$;

comment on function organisation_role(uuid) is
  'The preset of the signed-in user in an organisation, null when not a member. For display: no policy reads it, every policy asks has_capability().';

-- The one question, about a row whose organisation, project and
-- participant are known. SECURITY DEFINER so that the policies on the
-- tables it reads (organisation_members, project_shares, participants) do
-- not recurse into themselves. PL/pgSQL: it names tables created after it.
--
-- A key presented in the transaction (use_api_key()) narrows the answer:
-- its organisation only, and the capabilities on its list only, on top of
-- what its issuer holds.
create or replace function row_has_capability(
  p_organisation_id uuid,
  p_project_id      uuid,
  p_participant_id  uuid,
  p_capability      text
)
returns boolean
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if v_user is null or p_capability is null then
    return false;
  end if;
  if v_claims ? 'api_key_organisation' then
    if (v_claims ->> 'api_key_organisation')::uuid is distinct from p_organisation_id
       or not coalesce(v_claims -> 'api_key_capabilities' ? p_capability, false) then
      return false;
    end if;
  end if;
  if exists (select 1 from organisation_members m
               join role_capabilities rc on rc.role = m.role::text and rc.capability = p_capability
              where m.organisation_id = p_organisation_id and m.user_id = v_user) then
    return true;
  end if;
  if p_project_id is not null and exists (
       select 1 from project_shares s
         join role_capabilities rc on rc.role = s.role and rc.capability = p_capability
        where s.project_id = p_project_id and s.user_id = v_user) then
    return true;
  end if;
  if p_participant_id is not null
     and exists (select 1 from role_capabilities rc where rc.role = 'participant' and rc.capability = p_capability) then
    return exists (
      with recursive up as (
        select p.id, p.parent_id, p.user_id from participants p where p.id = p_participant_id
        union all
        select p.id, p.parent_id, p.user_id from participants p join up on p.id = up.parent_id
      )
      select 1 from up where up.user_id = v_user);
  end if;
  return false;
end;
$$;

comment on function row_has_capability(uuid, uuid, uuid, text) is
  'Whether the signed-in user holds a capability on a row of an organisation, of a project (null when none) and of a participant (null when none): as a member of the organisation, as a person the project is shared with, or as the account of the participant or of a group it is part of. A key presented in the transaction narrows it to its organisation and its list. False, never null.';

-- The same question about an object of the core named by its kind and id.
create or replace function has_capability(p_object_kind text, p_object_id uuid, p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if p_object_kind = 'organisation' then
    return row_has_capability(p_object_id, null, null, p_capability);
  end if;
  return coalesce(row_has_capability(object_organisation(p_object_kind, p_object_id),
                                     project_of(p_object_kind, p_object_id),
                                     participant_of(p_object_kind, p_object_id), p_capability), false);
exception when no_data_found then
  -- An object that does not exist grants nothing.
  return false;
end;
$$;

comment on function has_capability(text, uuid, text) is
  'Whether the signed-in user may do one named thing (a capabilities code) on one object of the core named by its kind and id: the question every policy and every gesture asks. Resolves the organisation membership, the project share and the account of the participant (row_has_capability).';

-- What the signed-in user may do on an object, for an interface or an
-- agent that has to know before it tries.
create or replace function my_capabilities(p_object_kind text, p_object_id uuid)
returns setof text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select c.code from capabilities c where has_capability(p_object_kind, p_object_id, c.code) order by c.code;
$$;

comment on function my_capabilities(text, uuid) is
  'The capabilities the signed-in user holds on one object of the core, presets resolved.';

-- Applies the standard policies to a table that carries organisation_id:
-- data.read reads, data.write writes (or the capability named). The table
-- may be schema-qualified (a module's); policy names are derived from it.
-- When a row belongs to a project, the expression of its project
-- (`project_id`, `project_of('participant', participant_id)`) lets a person
-- the project is shared with reach it; when it belongs to a participant,
-- the expression of its participant (`participant_id`,
-- `participant_of(object_kind, object_id)`) lets the account of that
-- participant reach it.
create or replace procedure secure_table(
  p_table       text,
  p_project     text default null,
  p_participant text default null,
  p_write       text default 'data.write'
)
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  n text := replace(p_table, '.', '_');
  r text := format('nexgen.row_has_capability(organisation_id, %s, %s, %L)',
                   coalesce(p_project, 'null'), coalesce(p_participant, 'null'), 'data.read');
  w text := format('nexgen.row_has_capability(organisation_id, %s, %s, %L)',
                   coalesce(p_project, 'null'), coalesce(p_participant, 'null'), p_write);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy %I on %s for select to authenticated using (%s)', n || '_select', p_table, r);
  execute format('create policy %I on %s for all to authenticated using (%s) with check (%s)', n || '_write', p_table, w, w);
  execute format('grant select, insert, update, delete on %s to authenticated, service_role', p_table);
end;
$$;

comment on procedure secure_table(text, text, text, text) is
  'Row level security on a table that carries organisation_id: whoever holds data.read reads, whoever holds data.write (or the capability named) writes. Given the expression of a row''s project, a person the project is shared with reaches it; given the expression of its participant, the account of that participant does (row_has_capability).';

-- Whoever creates an organisation owns it. Without this, the creator could
-- not read the row they just inserted.
create or replace function organisations_add_creator()
returns trigger
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
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
set search_path = nexgen, extensions, pg_temp
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
  for select to authenticated using (has_capability('organisation', id, 'data.read'));
create policy organisations_insert on organisations
  for insert to authenticated with check (auth.uid() is not null);
create policy organisations_update on organisations
  for update to authenticated using (has_capability('organisation', id, 'organisation.write'))
  with check (has_capability('organisation', id, 'organisation.write'));
create policy organisations_delete on organisations
  for delete to authenticated using (has_capability('organisation', id, 'organisation.write'));

create policy organisation_members_select on organisation_members
  for select to authenticated using (has_capability('organisation', organisation_id, 'data.read'));
create policy organisation_members_write on organisation_members
  for all to authenticated
  using (has_capability('organisation', organisation_id, 'members.manage'))
  with check (has_capability('organisation', organisation_id, 'members.manage'));

grant select, insert, update, delete on organisations, organisation_members to authenticated, service_role;
grant execute on function organisation_role(uuid), row_has_capability(uuid, uuid, uuid, text),
  has_capability(text, uuid, text), my_capabilities(text, uuid) to authenticated, service_role;

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
set search_path = nexgen, extensions, pg_temp
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
set search_path = nexgen, extensions, pg_temp
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
set search_path = nexgen, extensions, pg_temp
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
set search_path = nexgen, extensions, pg_temp
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
