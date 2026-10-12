-- Nexgen OS — core: workspaces and who may work in them.
--
-- A workspace is whoever owns a body of descriptions: an architecture firm, a
-- municipality, a housing company, an installer, a family. Every row of the
-- core carries the `workspace_id` it belongs to, and row level security is
-- driven by `workspace_members`. One installation may hold many workspaces.

-- Geometry lives in PostGIS. On a hosted Supabase project the extension is
-- already available; on a bare Postgres it has to be installed beforehand.
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Generic BEFORE UPDATE trigger keeping updated_at honest.';

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'editor', 'viewer');

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workspaces_name_not_blank check (btrim(name) <> '')
);

comment on table workspaces is
  'Owner of a body of descriptions. Every core row belongs to exactly one workspace.';

create trigger workspaces_set_updated_at
  before update on workspaces
  for each row execute function set_updated_at();

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null,
  role         member_role not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

comment on table workspace_members is
  'Who may read or write a workspace. `owner` administers, `editor` writes, `viewer` reads. An agent acting for a person is that person.';

create index workspace_members_user_id_idx on workspace_members (user_id);

create trigger workspace_members_set_updated_at
  before update on workspace_members
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers
--
-- SECURITY DEFINER so that the policy on `workspace_members` itself does not
-- recurse into the table it protects.
-- ---------------------------------------------------------------------------

create or replace function workspace_role(p_workspace_id uuid)
returns member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from workspace_members m
   where m.workspace_id = p_workspace_id
     and m.user_id = auth.uid();
$$;

create or replace function can_read_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select workspace_role(p_workspace_id) is not null;
$$;

create or replace function can_write_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select workspace_role(p_workspace_id) in ('owner', 'editor');
$$;

create or replace function is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select workspace_role(p_workspace_id) = 'owner';
$$;

-- Whoever creates a workspace owns it. Without this, the creator could not
-- read the row they just inserted.
create or replace function workspaces_add_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger workspaces_add_creator
  after insert on workspaces
  for each row execute function workspaces_add_creator();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table workspaces enable row level security;
alter table workspace_members enable row level security;

create policy workspaces_select on workspaces
  for select to authenticated using (can_read_workspace(id));
create policy workspaces_insert on workspaces
  for insert to authenticated with check (auth.uid() is not null);
create policy workspaces_update on workspaces
  for update to authenticated using (is_workspace_owner(id)) with check (is_workspace_owner(id));
create policy workspaces_delete on workspaces
  for delete to authenticated using (is_workspace_owner(id));

create policy workspace_members_select on workspace_members
  for select to authenticated using (can_read_workspace(workspace_id));
create policy workspace_members_write on workspace_members
  for all to authenticated
  using (is_workspace_owner(workspace_id))
  with check (is_workspace_owner(workspace_id));

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on workspaces, workspace_members to authenticated, service_role;
grant execute on function workspace_role(uuid), can_read_workspace(uuid),
  can_write_workspace(uuid), is_workspace_owner(uuid) to authenticated, service_role;
