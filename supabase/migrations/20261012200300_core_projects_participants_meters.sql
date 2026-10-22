-- Nexgen OS — core: projects, the participants taking part in them, and the
-- meters they carry.
--
-- A project is what a person works on: an energy community, a set of
-- buildings, a study, a construction site, a district plan, with the country whose rules
-- apply and a lifecycle.
--
-- A participant is the node of a project (decision 0043): an actor — a
-- household, a company, a tenant, a PV plant — as producer, consumer or
-- prosumer, with the contact who answers for it and the period it is in. It
-- carries the place: its address and its point on the map, its time zone,
-- in the one standard shape (`place_of()`). It carries the meters, one and
-- exceptionally several, and groups the devices behind them. Every module
-- starts from it: the description of its ground and its buildings, the grid
-- side of its meters, its bills, its share of a community, its actions, its
-- weather. A participant is in one project; participants may be grouped
-- (two tenants of one landlord, a campus), a group having no place of its
-- own and carrying no meter and no device.
--
-- A meter, in the sense of the grid, is a connection point to a network:
-- the identifier its operator knows, carried by a participant, with what it
-- can do (take, inject, both) and the period that identifier names that
-- point (IEC CIM UsagePoint). It is the frontier between the grid and the
-- place: what is in front of it belongs to the project (the grid, the
-- market, the sharing of a community), what is behind it to the participant
-- that carries it (`meters.participant_id`). The physical meter is a device of type
-- `meter` and can be swapped. Who runs the grid and how the point is
-- connected are the `grid` module's (decision 0042).
--
-- The hierarchy a page walks: organisation → project → participant → meter
-- and device → series.

set search_path = nexgen, extensions;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table projects (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  name             text not null,
  -- What the project is (`project_kinds`): a study, a rooftop PV project,
  -- an energy community, a self-consumption operation, a district plan,
  -- or the legal frame of its country a pack publishes. The defaults a
  -- frame decides are read with it as a condition (parameter_of()).
  kind             text not null default 'study' references project_kinds(code),
  -- ISO 3166-1 alpha-2 of the country whose rules apply. Selects the packs.
  country          char(2) not null,
  -- Perimeter on the map, when it has one.
  geometry         geometry,
  status           text not null default 'simulation',
  start_date       date,
  end_date         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_country_format check (country ~ '^[A-Z]{2}$'),
  constraint projects_status check (status in ('simulation', 'creation', 'active', 'inactive', 'archived')),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3))
);

comment on table projects is
  'What a person works on: an energy community, a set of buildings, a study, a construction site, a district plan, with its country and its lifecycle (simulation, creation, active, inactive, archived). Its actors are participants.';

create index projects_geometry_idx on projects using gist (geometry);

create or replace function projects_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k project_kinds%rowtype;
begin
  select * into k from project_kinds where code = new.kind;
  if not found then
    raise exception 'project_kind_unknown: % is not a project_kinds code', new.kind using errcode = 'foreign_key_violation';
  end if;
  if k.country is not null and k.country <> new.country then
    raise exception 'project_kind_foreign: % is a frame of %, the project is in %', new.kind, k.country, new.country
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function projects_check() is
  'BEFORE INSERT / UPDATE on projects: the kind is a project_kinds code (project_kind_unknown), and a legal frame of a country is used in that country only (project_kind_foreign).';

create trigger projects_check before insert or update of kind, country on projects
  for each row execute function projects_check();
create trigger projects_normalize before insert or update of geometry on projects
  for each row execute function normalize_geometry('geometry');
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();
create index projects_organisation_idx on projects (organisation_id);
create trigger projects_drop_attachments after delete on projects
  for each row execute function drop_attachments('project');
-- ---------------------------------------------------------------------------
-- project_shares — a project shared with a person outside its organisation.
-- ---------------------------------------------------------------------------

create table project_shares (
  project_id       uuid not null references projects(id) on delete cascade,
  user_id          uuid not null,
  -- Copied from the project, so that its organisation lists who it shared with.
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- viewer reads the project and everything under it; editor writes it too.
  role             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint project_shares_role check (role in ('viewer', 'editor'))
);

comment on table project_shares is
  'A project shared with a person beside the members of its organisation: viewer reads the project and everything under it (its participants, their meters, devices, series and attachments), editor writes them too. Managed by the owners and editors of the organisation.';

create index project_shares_user_idx on project_shares (user_id);

create or replace function project_shares_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  new.organisation_id := (select organisation_id from projects where id = new.project_id);
  if new.organisation_id is null then
    raise exception 'project_not_found: %', new.project_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger project_shares_check before insert or update of project_id, organisation_id on project_shares
  for each row execute function project_shares_check();
create trigger project_shares_set_updated_at before update on project_shares
  for each row execute function set_updated_at();

alter table project_shares enable row level security;
create policy project_shares_select on project_shares for select to authenticated
  using (has_capability('organisation', organisation_id, 'data.read') or user_id = auth.uid());
create policy project_shares_write on project_shares for all to authenticated
  using (has_capability('organisation', organisation_id, 'shares.manage'))
  with check (has_capability('organisation', organisation_id, 'shares.manage'));
grant select, insert, update, delete on project_shares to authenticated, service_role;

call secure_table('projects', 'id');

-- ---------------------------------------------------------------------------
-- invitations — a membership offered by email, taken when the person signs in.
--
-- The same columns and the same gestures as the invitations of Ekwo OS
-- (`company_invitations`, `invite_member()`, `accept_invitation()`,
-- `revoke_invitation()`), so that a person invited into an organisation and
-- into the Ekwo company it is goes through one act twice, not two acts.
-- The token is handed over once and kept only as its sha256
-- (`token_hash`, Postgres' own `sha256()`, no extension): a backup hands
-- nobody an invitation. Re-inviting an address revokes the invitation still
-- open to it. What differs from Ekwo OS is what Nexgen OS has and Ekwo OS
-- does not: an invitation may share one project (`project_id`) or open the
-- account of one participant (`participant_id`, added with the
-- participants below), and the roles are the presets of an organisation,
-- of a project or of a participant's account, resolved into capabilities
-- like every other access (role_capabilities).
-- ---------------------------------------------------------------------------

create table invitations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  -- Null: a membership of the organisation; set: the project is shared.
  project_id       uuid references projects(id) on delete cascade,
  email            text not null,
  -- owner, editor or viewer of an organisation; editor or viewer of a project.
  role             text not null,
  -- The sha256 of the token the link carries, in hexadecimal; the token
  -- itself is returned once by invite_member() and stored nowhere.
  token_hash       text not null unique,
  invited_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  accepted_at      timestamptz,
  accepted_by      uuid,
  revoked_at       timestamptz,
  constraint invitations_email_format check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  constraint invitations_role check (
    (project_id is null and role in ('owner', 'editor', 'viewer')) or (project_id is not null and role in ('editor', 'viewer'))),
  constraint invitations_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint invitations_accepted check ((accepted_at is null) = (accepted_by is null)),
  constraint invitations_accepted_or_revoked check (accepted_at is null or revoked_at is null)
);

comment on table invitations is
  'A membership offered to a person by email: of an organisation (owner, editor, viewer) or of one of its projects (editor, viewer), with the sha256 of the token of the link sent, its expiry, when and by whom it was accepted, and when it was revoked. The columns of Ekwo OS''s company_invitations. Written by invite_member(), taken by accept_invitation() or accept_invitations() when the person signs in, withdrawn by revoke_invitation().';

create index invitations_email_idx on invitations (email) where accepted_at is null and revoked_at is null;
create index invitations_organisation_idx on invitations (organisation_id, created_at desc);

create or replace function invitations_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if new.project_id is not null and not exists (select 1 from projects p where p.id = new.project_id and p.organisation_id = new.organisation_id) then
    raise exception 'project_in_other_organisation: %', new.project_id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger invitations_check before insert or update of organisation_id, project_id on invitations
  for each row execute function invitations_check();

alter table invitations enable row level security;
create policy invitations_select on invitations for select to authenticated
  using (has_capability('organisation', organisation_id, 'shares.manage'));
create policy invitations_write on invitations for all to authenticated
  using (has_capability('organisation', organisation_id, 'shares.manage'))
  with check (has_capability('organisation', organisation_id, 'shares.manage'));
grant select, insert, update, delete on invitations to authenticated, service_role;

-- The hash an invitation keeps of its token.
create or replace function invitation_token_hash(p_token text)
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Offers a membership by email: of the organisation, or of one of its
-- projects. Only an owner offers ownership. The token is two random uuids
-- without their dashes, 256 bits, returned here and nowhere else.
create or replace function invite_member(
  p_organisation_id  uuid,
  p_email            text,
  p_role             text,
  p_project_id       uuid default null,
  p_valid_for        interval default interval '14 days'
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  i invitations%rowtype;
begin
  if not has_capability('organisation', p_organisation_id, 'shares.manage') and not caller_bypasses_rls() then
    raise exception 'organisation_not_found: %', p_organisation_id using errcode = 'no_data_found';
  end if;
  if p_role = 'owner' and not has_capability('organisation', p_organisation_id, 'members.manage') and not caller_bypasses_rls() then
    raise exception 'owner_required: only an owner offers ownership' using errcode = 'insufficient_privilege';
  end if;
  -- Re-inviting the same address to the same place revokes the invitation
  -- still open to it: one seat, one live token.
  update invitations x
     set revoked_at = now()
   where x.organisation_id = p_organisation_id and x.project_id is not distinct from p_project_id
     and x.email = v_email and x.accepted_at is null and x.revoked_at is null;
  insert into invitations (organisation_id, project_id, email, role, token_hash, expires_at)
  values (p_organisation_id, p_project_id, v_email, p_role, invitation_token_hash(v_token), now() + p_valid_for)
  returning * into i;
  return query select i.id, v_token, i.expires_at;
end;
$$;

comment on function invite_member(uuid, text, text, uuid, interval) is
  'Offers a person, by email, a membership of an organisation (owner, editor, viewer) or of one of its projects (editor, viewer), for fourteen days unless said otherwise; returns (invitation_id, token, expires_at), the token to send in a link, once: only its hash is kept. Re-inviting the same address revokes the invitation still open to it. The gesture of Ekwo OS of the same name. Refuses organisation_not_found, owner_required, project_in_other_organisation, invitations_role, invitations_email_format.';

-- Takes one invitation: the signed-in person whose address it was sent to
-- becomes a member of the organisation or of the project.
create or replace function invitation_take(i invitations)
returns void
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if i.participant_id is not null then
    update participants set user_id = auth.uid()
     where id = i.participant_id and (user_id is null or user_id = auth.uid());
    if not found then
      raise exception 'participant_has_account: the participant % already has an account', i.participant_id
        using errcode = 'unique_violation';
    end if;
  elsif i.project_id is null then
    insert into organisation_members (organisation_id, user_id, role) values (i.organisation_id, auth.uid(), i.role::member_role)
    on conflict (organisation_id, user_id) do nothing;
  else
    insert into project_shares (project_id, user_id, role) values (i.project_id, auth.uid(), i.role)
    on conflict (project_id, user_id) do update set role = excluded.role;
  end if;
  update invitations set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
end;
$$;

revoke execute on function invitation_take(invitations) from public;

create or replace function accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  i invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign_in_required: an invitation is accepted by the person signed in' using errcode = 'insufficient_privilege';
  end if;
  select * into i from invitations where token_hash = invitation_token_hash(p_token) for update;
  if i.id is null then
    raise exception 'invitation_not_found' using errcode = 'no_data_found';
  end if;
  if i.revoked_at is not null then
    raise exception 'invitation_revoked: on %', i.revoked_at using errcode = 'check_violation';
  end if;
  if i.accepted_at is not null then
    raise exception 'invitation_already_accepted: on %', i.accepted_at using errcode = 'check_violation';
  end if;
  if i.expires_at <= now() then
    raise exception 'invitation_expired: on %', i.expires_at using errcode = 'check_violation';
  end if;
  if lower(coalesce(auth.email(), '')) <> i.email then
    raise exception 'invitation_for_other_email: the invitation was sent to another address' using errcode = 'insufficient_privilege';
  end if;
  perform invitation_take(i);
  return jsonb_strip_nulls(jsonb_build_object('organisation_id', i.organisation_id, 'project_id', i.project_id,
    'participant_id', i.participant_id, 'role', i.role));
end;
$$;

comment on function accept_invitation(text) is
  'The signed-in person takes the invitation of a link: a member of the organisation, or of the project, in the role offered, or the account of the participant. Refuses participant_has_account, sign_in_required, invitation_not_found, invitation_revoked, invitation_already_accepted, invitation_expired, invitation_for_other_email.';

-- Every invitation still open to the address of the person signed in: what
-- an application calls when a person signs in.
create or replace function accept_invitations()
returns integer
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  i invitations%rowtype;
  n integer := 0;
begin
  if auth.uid() is null or auth.email() is null then
    raise exception 'sign_in_required: invitations are taken by the person signed in' using errcode = 'insufficient_privilege';
  end if;
  for i in select * from invitations
            where email = lower(auth.email()) and accepted_at is null and revoked_at is null and expires_at > now()
            order by created_at for update loop
    perform invitation_take(i);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function accept_invitations() is
  'Takes every open invitation sent to the address of the person signed in, as they sign in; returns how many. Refuses sign_in_required.';

-- Withdraws an invitation not yet accepted: its link answers as one that
-- never existed would, but by its name.
create or replace function revoke_invitation(p_invitation_id uuid)
returns invitations
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  i invitations%rowtype;
begin
  select * into i from invitations where id = p_invitation_id for update;
  if i.id is null then
    raise exception 'invitation_not_found: %', p_invitation_id using errcode = 'no_data_found';
  end if;
  if i.accepted_at is not null then
    raise exception 'invitation_already_accepted: on %; remove the member instead', i.accepted_at using errcode = 'check_violation';
  end if;
  update invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation_id returning * into i;
  return i;
end;
$$;

comment on function revoke_invitation(uuid) is
  'Withdraws an invitation not yet accepted, as Ekwo OS''s gesture of the same name; a second call changes nothing. Read and written under the caller''s row level security: an owner or an editor of the organisation. Refuses invitation_not_found, invitation_already_accepted.';

grant execute on function invite_member(uuid, text, text, uuid, interval), accept_invitation(text), accept_invitations(),
  revoke_invitation(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- participants — the node of a project, and its place.
-- ---------------------------------------------------------------------------

create table participants (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisations(id) on delete cascade,
  project_id       uuid not null references projects(id) on delete cascade,
  -- The group it is part of.
  parent_id        uuid references participants(id) on delete restrict,
  -- The account of the end customer it is (auth.users.id): a household
  -- with its contract, a business on its group. It reads this participant,
  -- the participants it groups and everything under them, with the preset
  -- `participant` (role_capabilities); a person may hold the account of
  -- several participants, of several organisations (decision 0052).
  user_id          uuid,
  name             text not null,
  role             text not null default 'consumer',
  -- Its customer segment (`segments`): a household, a co-ownership, a
  -- business, a public body, an association. Every participant has one,
  -- so it is a column (decision 0019); a tariff, a tax or a reference price
  -- that differs by segment is a default read with it as a condition.
  -- A household unless said otherwise, as the platform the core was taken
  -- from defaults its members.
  segment          text not null default 'individual' references segments(code),
  -- Who answers for it: the owner, the tenant, the company.
  contact_id       uuid references contacts(id) on delete set null,
  status           text not null default 'simulation',
  join_date        date,
  leave_date       date,
  -- The place, in its one standard shape (`place_of()`, docs/model.md
  -- "Where"): the address in the fields every country has (the postal
  -- address of schema.org) — the street with its number, a second line for
  -- the building, floor or unit, the postal code, the city, the ISO 3166-2
  -- region, the ISO 3166-1 alpha-2 country; how a country lays them out is
  -- its pack's business. The municipality, in the country's own code (a
  -- value of its pack's municipality scheme): many participants share
  -- one, so it is part of the place and not an identifier, which names one
  -- object only (decision 0009). A group has no place: its country and
  -- every place column are null.
  country          char(2),
  address_line1    text,
  address_line2    text,
  postal_code      text,
  city             text,
  region           text,
  municipality     text,
  -- IANA time zone. Daily and monthly readings of its series are cut in it;
  -- a participant without one has no daily readings.
  time_zone        text,
  -- Its point on the map, or the outline of its place.
  geometry         geometry,
  -- How close the geometry is to the real place, and who placed it: a
  -- geocoder (a source), a GPS reading, a person on a map. `rooftop` is the
  -- building itself, `parcel` its plot, then the street, the postal code
  -- area, the city, the region. Null when nobody said.
  location_precision   text,
  location_source_code text references sources(code),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint participants_name_not_blank check (btrim(name) <> ''),
  constraint participants_role check (role in ('producer', 'consumer', 'prosumer')),
  constraint participants_status check (status in ('simulation', 'creation', 'active', 'inactive', 'pending_consent')),
  constraint participants_period check (leave_date is null or join_date is null or leave_date >= join_date),
  constraint participants_not_own_parent check (parent_id is distinct from id),
  constraint participants_country_format check (country ~ '^[A-Z]{2}$'),
  constraint participants_region_format check (region is null or region ~ ('^' || country || '-[A-Z0-9]{1,3}$')),
  constraint participants_group_has_no_place check (country is not null or num_nonnulls(address_line1, address_line2, postal_code, city, region, municipality,
    time_zone, geometry, location_precision, location_source_code) = 0),
  constraint participants_geometry_core check (geometry is null or (ST_SRID(geometry) = 4326 and ST_NDims(geometry) = 3)),
  constraint participants_location_precision check (location_precision is null or location_precision in ('rooftop', 'parcel', 'street', 'postal_code', 'city', 'region'))
);

comment on table participants is
  'The node of a project: an actor — a household, a company, a tenant, a PV plant — as producer, consumer or prosumer, with the contact who answers for it and the period it is in. It carries the place (address, point, time zone, precision and source: the one standard shape of place_of()), the meters (meters.participant_id) and the devices behind them (devices.participant_id); every module links to it. A participant without a place is a group of others, and carries no meter and no device.';

create index participants_project_idx on participants (project_id);
create index participants_parent_idx on participants (parent_id);
create index participants_user_idx on participants (user_id) where user_id is not null;
create index participants_geometry_idx on participants using gist (geometry);
create trigger participants_normalize before insert or update of geometry on participants
  for each row execute function normalize_geometry('geometry');

create or replace function participants_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  p participants%rowtype;
begin
  if not exists (select 1 from segments where code = new.segment) then
    raise exception 'segment_unknown: % is not a segments code', new.segment using errcode = 'foreign_key_violation';
  end if;
  if new.parent_id is not null then
    select * into p from participants where id = new.parent_id;
    if p.country is not null then
      raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
    end if;
    if p.project_id <> new.project_id then
      raise exception 'participant_parent_in_other_project' using errcode = 'check_violation';
    end if;
  end if;
  if new.contact_id is not null and not exists (
    select 1 from contacts c where c.id = new.contact_id and c.organisation_id = new.organisation_id
  ) then
    raise exception 'participant_contact_in_other_organisation' using errcode = 'check_violation';
  end if;
  if new.time_zone is not null then
    begin
      perform now() at time zone new.time_zone;
    exception when invalid_parameter_value then
      raise exception 'time_zone_unknown: %', new.time_zone using errcode = 'check_violation';
    end;
  end if;
  if new.country is null and tg_op = 'UPDATE' and (
       exists (select 1 from meters m where m.participant_id = new.id)
       or exists (select 1 from devices d where d.participant_id = new.id)) then
    raise exception 'participant_group_carries: a group carries no meter and no device' using errcode = 'check_violation';
  end if;
  if new.country is not null and tg_op = 'UPDATE' and exists (select 1 from participants c where c.parent_id = new.id) then
    raise exception 'participant_parent_not_a_group' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function participants_check() is
  'BEFORE INSERT / UPDATE on participants: the segment is a segments code (segment_unknown), a parent is a group of the same project (participant_parent_not_a_group, participant_parent_in_other_project), the contact is of the organisation (participant_contact_in_other_organisation), the time zone is an IANA zone Postgres knows (time_zone_unknown), a group carries no meter and no device (participant_group_carries).';

create trigger participants_check before insert or update of segment, parent_id, project_id, contact_id, join_date, leave_date, time_zone, country on participants
  for each row execute function participants_check();
create trigger participants_project_id_check before insert or update of project_id on participants
  for each row execute function parent_check('project_id', 'projects');
create trigger participants_parent_id_check before insert or update of parent_id on participants
  for each row execute function parent_check('parent_id', 'participants');
create trigger participants_set_updated_at before update on participants
  for each row execute function set_updated_at();
create index participants_organisation_idx on participants (organisation_id);
create trigger participants_drop_attachments after delete on participants
  for each row execute function drop_attachments('participant');
call secure_table('participants', 'project_id', 'id');

-- ---------------------------------------------------------------------------
-- The account of a participant, opened by an invitation (decision 0052).
-- ---------------------------------------------------------------------------

alter table invitations add column participant_id uuid references participants(id) on delete cascade;
alter table invitations drop constraint invitations_role;
alter table invitations add constraint invitations_role check (
  (participant_id is not null and role = 'participant')
  or (participant_id is null and project_id is null and role in ('owner', 'editor', 'viewer'))
  or (participant_id is null and project_id is not null and role in ('editor', 'viewer')));
comment on column invitations.participant_id is
  'Set: the invitation opens the account of this participant (participants.user_id) to the person it was sent to, with the preset participant.';

-- Offers the account of a participant to the end customer it is, by email.
-- The organisation and the project are the participant's.
create or replace function invite_participant(
  p_participant_id uuid,
  p_email          text,
  p_valid_for      interval default interval '14 days'
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  p participants%rowtype;
  i invitations%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if p.id is null or not (has_capability('organisation', p.organisation_id, 'shares.manage') or caller_bypasses_rls()) then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  update invitations x
     set revoked_at = now()
   where x.participant_id = p_participant_id and x.accepted_at is null and x.revoked_at is null;
  insert into invitations (organisation_id, project_id, participant_id, email, role, token_hash, expires_at)
  values (p.organisation_id, p.project_id, p.id, v_email, 'participant', invitation_token_hash(v_token), now() + p_valid_for)
  returning * into i;
  return query select i.id, v_token, i.expires_at;
end;
$$;

comment on function invite_participant(uuid, text, interval) is
  'Offers the account of a participant to the end customer it is, by email, for fourteen days unless said otherwise; returns (invitation_id, token, expires_at), the token once. On acceptance (accept_invitation(), accept_invitations()) the person becomes participants.user_id and reads that participant, the participants it groups and everything under them. Re-inviting revokes the invitation still open. Whoever holds shares.manage on the organisation. Refuses participant_not_found, invitations_email_format.';

grant execute on function invite_participant(uuid, text, interval) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- meters — connection points.
-- ---------------------------------------------------------------------------

create table meters (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisations(id) on delete cascade,
  -- The participant that carries it: what is behind the point is that
  -- participant's.
  participant_id    uuid not null references participants(id) on delete cascade,
  -- The project of that participant, copied: a study project may describe
  -- the same connection point as the project that runs it, one open
  -- participant per point within a project.
  project_id        uuid not null references projects(id) on delete cascade,
  name              text,
  -- The metering point identifier and its numbering scheme (a GS1 GSRN, or
  -- a national scheme a pack publishes).
  identifier        text not null,
  scheme            text not null references identifier_schemes(code),
  resource          text not null default 'electricity',
  -- What the point can do: take from the grid, inject into it, both.
  direction         text not null default 'both',
  -- When this identifier names this point: registers retire and reissue.
  valid_from        date,
  valid_to          date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meters_resource check (resource in ('electricity', 'gas', 'heat', 'water')),
  constraint meters_direction check (direction in ('offtake', 'injection', 'both')),
  constraint meters_period check (valid_to is null or valid_from is null or valid_to > valid_from)
);

comment on table meters is
  'A connection point to a network, with the identifier its operator knows (IEC CIM UsagePoint), carried by a participant: the frontier between the grid and the place. The devices of that participant are behind it. The physical meter is a device of type meter, and can be swapped. The grid module adds who runs it and how it is connected. Its identifier names one open connection point within a project; another project (a study, a scenario) may describe the same point with a participant of its own.';

create unique index meters_one_identifier on meters (project_id, scheme, identifier, valid_from) nulls not distinct;
-- One open connection point per identifier within a project.
create unique index meters_one_open on meters (project_id, scheme, identifier) where valid_to is null;
create index meters_identifier_idx on meters (scheme, identifier);
create index meters_participant_idx on meters (participant_id);

create or replace function meters_check()
returns trigger
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if not identifier_valid(new.scheme, new.identifier) then
    raise exception 'invalid_identifier: % is not a valid %', new.identifier, new.scheme
      using errcode = 'check_violation';
  end if;
  if (select country from participants where id = new.participant_id) is null then
    raise exception 'participant_group_carries: a group carries no meter and no device' using errcode = 'check_violation';
  end if;
  new.project_id := (select project_id from participants where id = new.participant_id);
  return new;
end;
$$;

comment on function meters_check() is
  'BEFORE INSERT / UPDATE on meters: the identifier matches its scheme (invalid_identifier); the participant that carries it is not a group (participant_group_carries); the project is the participant''s, copied.';

create trigger meters_check before insert or update of identifier, scheme, participant_id, project_id on meters
  for each row execute function meters_check();
create trigger meters_participant_id_check before insert or update of participant_id on meters
  for each row execute function parent_check('participant_id', 'participants');
create trigger meters_set_updated_at before update on meters
  for each row execute function set_updated_at();
create index meters_organisation_idx on meters (organisation_id);
create trigger meters_drop_attachments after delete on meters
  for each row execute function drop_attachments('meter');
-- The project an object belongs to: itself, its participant's, its
-- object's for a series. Null for an organisation. SECURITY DEFINER: the
-- policies of the rows under a project read it, and it says nothing but an id.
create or replace function project_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
begin
  return case p_kind
    when 'project' then p_id
    when 'organisation' then null
    when 'series' then (select project_of(se.object_kind, se.object_id) from series se where se.id = p_id)
    else (select pa.project_id from participants pa where pa.id = participant_of(p_kind, p_id))
  end;
end;
$$;

comment on function project_of(text, uuid) is
  'The project an object of the core belongs to (itself, its participant''s, its object''s for a series); null for an organisation. Read by the policies of a project shared with a person.';

grant execute on function project_of(text, uuid) to authenticated, service_role;

call secure_table('meters', 'project_of(''participant'', participant_id)', 'participant_id');

-- The connection points a participant carries, or the participants it
-- groups carry.
create or replace function participant_meters(p_participant_id uuid)
returns table (meter_id uuid)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  with recursive down as (
    select id from participants where id = p_participant_id
    union all
    select p.id from participants p join down on p.parent_id = down.id
  )
  select m.id from meters m join down on m.participant_id = down.id;
$$;

comment on function participant_meters(uuid) is
  'The connection points a participant carries (meters.participant_id), and those the participants it groups carry.';

-- ---------------------------------------------------------------------------
-- Where an object is.
-- ---------------------------------------------------------------------------

-- The participant of an object, through the foreign keys of the core: a
-- participant is its own, a meter and a device name theirs, a series is its
-- object's. Null for what belongs to no participant (an organisation, a
-- project). SECURITY DEFINER, like project_of(): the policies of the rows
-- under a participant read it, and it says nothing but an id.
create or replace function participant_of(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
begin
  if p_id is null then
    return null;
  end if;
  case p_kind
    when 'participant' then
      return (select id from participants where id = p_id);
    when 'meter' then
      return (select participant_id from meters where id = p_id);
    when 'device' then
      return (select participant_id from devices where id = p_id);
    when 'series' then
      return (select participant_of(object_kind, object_id) from series where id = p_id);
    when 'organisation', 'project' then
      return null;
    else
      raise exception 'kind_unknown: %', p_kind using errcode = 'foreign_key_violation';
  end case;
end;
$$;

comment on function participant_of(text, uuid) is
  'The participant an object named by its kind and its id belongs to: itself, its own foreign key for a meter or a device, its object''s for a series. Null for an organisation or a project. Refuses kind_unknown.';

create or replace function country_of(p_kind text, p_id uuid)
returns char(2)
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select country from participants where id = participant_of(p_kind, p_id);
$$;

comment on function country_of(text, uuid) is
  'The country of the place of the participant an object belongs to. Selects the country packs and the country level of parameter_of().';

-- PL/pgSQL so that it may name `identifiers`, created with the attachments.
create or replace function place_of(p_participant_id uuid)
returns jsonb
language plpgsql
stable
set search_path = nexgen, extensions, pg_temp
as $$
begin
  return (select jsonb_build_object(
    'address_line1', p.address_line1, 'address_line2', p.address_line2, 'postal_code', p.postal_code, 'city', p.city,
    'region', p.region, 'municipality', p.municipality, 'country', p.country,
    'geometry', ST_AsGeoJSON(p.geometry)::jsonb,
    'location_precision', p.location_precision, 'location_source_code', p.location_source_code,
    'identifiers', coalesce((select jsonb_agg(jsonb_build_object('scheme', e.scheme, 'value', e.value) order by e.scheme, e.value)
                               from identifiers e where e.object_kind = 'participant' and e.object_id = p.id), '[]'::jsonb))
    from participants p where p.id = p_participant_id and p.country is not null);
end;
$$;

comment on function place_of(uuid) is
  'A participant''s place in the one standard shape: address, country, region, municipality, GeoJSON geometry, precision, source and identifiers. Null for a group.';

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

-- An actor joins a project with its place in the standard shape, or none
-- for a group. Without a time zone given, it takes its region's, else the
-- first of its country's — both from the country pack, when one is
-- installed; never a zone of another country.
create or replace function join_project(
  p_project_id  uuid,
  p_name        text,
  p_place       jsonb default null,
  p_role        text default 'consumer',
  p_contact_id  uuid default null,
  p_join_date   date default null,
  p_status      text default 'simulation',
  p_time_zone   text default null,
  p_parent_id   uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id      uuid := gen_random_uuid();
  p         projects%rowtype;
  v_place   jsonb := case when p_place is not null then place_check(p_place) end;
  v_country text := upper(v_place->>'country');
  v_region  text := v_place->>'region';
  v_zone    text := p_time_zone;
  i         jsonb;
begin
  select * into p from projects where id = p_project_id;
  if not found then
    raise exception 'project_not_found: %', p_project_id using errcode = 'no_data_found';
  end if;
  if v_place is not null and v_country is null then
    raise exception 'country_required: a place names its country' using errcode = 'invalid_parameter_value';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_invalid: % is not an ISO 3166-1 alpha-2 code', v_country using errcode = 'invalid_parameter_value';
  end if;
  if v_country is not null and v_zone is null then
    v_zone := coalesce((select r.time_zone from regions r where r.code = v_region),
                       (select c.time_zones[1] from countries c where c.code = v_country));
  end if;
  insert into participants (id, organisation_id, project_id, parent_id, name, role, contact_id, join_date, status,
                            country, address_line1, address_line2, postal_code, city, region, municipality, time_zone,
                            geometry, location_precision, location_source_code)
  values (v_id, p.organisation_id, p_project_id, p_parent_id, p_name, p_role, p_contact_id, p_join_date, p_status,
          v_country, v_place->>'address_line1', v_place->>'address_line2', v_place->>'postal_code', v_place->>'city', v_region, v_place->>'municipality', v_zone,
          case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end,
          v_place->>'location_precision', v_place->>'location_source_code');
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into identifiers (object_kind, object_id, scheme, value) values ('participant', v_id, i->>'scheme', i->>'value');
  end loop;
  return v_id;
end;
$$;

comment on function join_project(uuid, text, jsonb, text, uuid, date, text, text, uuid) is
  'An actor joins a project as producer, consumer or prosumer from a day, with its place in the standard shape, or none for a group; the time zone defaults to the region''s, else the country''s first, from the country pack. Refuses project_not_found, country_required, country_invalid, time_zone_unknown, region_unknown, invalid_geometry, place_key_unknown, participant_parent_not_a_group, participant_contact_in_other_organisation. Returns the participant.';

-- A participant placed again: by a geocoder, a GPS reading, a person on a
-- map. The keys the place gives replace the participant's; the keys it
-- leaves out are kept.
create or replace function locate_participant(p_participant_id uuid, p_place jsonb)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_place jsonb := place_check(p_place);
  s       participants%rowtype;
  i       jsonb;
begin
  select * into s from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  if s.country is null then
    raise exception 'participant_is_group: a group has no place' using errcode = 'check_violation';
  end if;
  if v_place ? 'country' and upper(v_place->>'country') is distinct from s.country then
    raise exception 'country_is_final: a place does not move to another country; the participant joins there' using errcode = 'check_violation';
  end if;
  update participants set
    address_line1        = case when v_place ? 'address_line1' then v_place->>'address_line1' else address_line1 end,
    address_line2        = case when v_place ? 'address_line2' then v_place->>'address_line2' else address_line2 end,
    postal_code          = case when v_place ? 'postal_code' then v_place->>'postal_code' else postal_code end,
    city                 = case when v_place ? 'city' then v_place->>'city' else city end,
    region               = case when v_place ? 'region' then v_place->>'region' else region end,
    municipality         = case when v_place ? 'municipality' then v_place->>'municipality' else municipality end,
    geometry             = case when v_place ? 'geometry'
                                then case when jsonb_typeof(v_place->'geometry') = 'object' then ST_GeomFromGeoJSON(v_place->'geometry') end
                                else geometry end,
    location_precision   = case when v_place ? 'location_precision' then v_place->>'location_precision' else location_precision end,
    location_source_code = case when v_place ? 'location_source_code' then v_place->>'location_source_code' else location_source_code end
   where id = p_participant_id;
  for i in select * from jsonb_array_elements(coalesce(v_place->'identifiers', '[]'::jsonb)) loop
    insert into identifiers (object_kind, object_id, scheme, value) values ('participant', p_participant_id, i->>'scheme', i->>'value')
    on conflict do nothing;
  end loop;
end;
$$;

comment on function locate_participant(uuid, jsonb) is
  'Places a participant again from a place in the standard shape: the keys given replace, the others are kept, identifiers are added. Refuses participant_not_found, participant_is_group, country_is_final, invalid_geometry.';

create or replace function leave_project(p_participant_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  update participants set leave_date = p_on, status = 'inactive'
   where id = p_participant_id and leave_date is null;
  if not found then
    raise exception 'participant_not_in_project: %', p_participant_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function leave_project(uuid, date) is
  'A participant leaves its project on a day; it may join again later. Refuses participant_not_in_project.';

create or replace function declare_meter(
  p_participant_id uuid,
  p_identifier     text,
  p_scheme         text,
  p_resource       text default 'electricity',
  p_direction      text default 'both',
  p_valid_from     date default null,
  p_name           text default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  p    participants%rowtype;
begin
  select * into p from participants where id = p_participant_id;
  if not found then
    raise exception 'participant_not_found: %', p_participant_id using errcode = 'no_data_found';
  end if;
  -- One open participant per connection point within a project; another
  -- project (a study, a scenario) may describe the same point.
  if exists (select 1 from meters m
              where m.project_id = p.project_id and m.scheme = p_scheme and m.identifier = p_identifier
                and m.valid_to is null) then
    raise exception 'meter_already_open: % % names an open connection point of this project', p_scheme, p_identifier
      using errcode = 'unique_violation';
  end if;
  insert into meters (id, organisation_id, participant_id, project_id, name, identifier, scheme, resource, direction, valid_from)
  values (v_id, p.organisation_id, p_participant_id, p.project_id, p_name, p_identifier, p_scheme, p_resource, p_direction, p_valid_from);
  return v_id;
end;
$$;

comment on function declare_meter(uuid, text, text, text, text, date, text) is
  'Declares a connection point carried by a participant under the identifier its operator knows. Refuses participant_not_found, invalid_identifier, meter_already_open, participant_group_carries. Returns its id.';

create or replace function assign_meter(p_meter_id uuid, p_participant_id uuid)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  update meters set participant_id = p_participant_id where id = p_meter_id;
  if not found then
    raise exception 'meter_not_found: %', p_meter_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function assign_meter(uuid, uuid) is
  'Gives a meter to another participant (a new tenant, a new owner). Refuses meter_not_found, participant_group_carries, parent_in_other_organisation.';

create or replace function close_meter(p_meter_id uuid, p_on date default current_date)
returns void
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
begin
  update meters set valid_to = p_on where id = p_meter_id and valid_to is null;
  if not found then
    raise exception 'meter_not_open: %', p_meter_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function close_meter(uuid, date) is
  'Ends the period an identifier names a connection point: the register retired it. Refuses meter_not_open.';

grant execute on function participant_meters(uuid), participant_of(text, uuid), country_of(text, uuid), place_of(uuid),
  join_project(uuid, text, jsonb, text, uuid, date, text, text, uuid), locate_participant(uuid, jsonb), leave_project(uuid, date),
  declare_meter(uuid, text, text, text, text, date, text), assign_meter(uuid, uuid), close_meter(uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_project — the gesture that opens a project in an organisation.
--
-- An insert that a policy allows would do the same; a gesture of its own is
-- what a surface calls (decision 0018), so that the MCP server and the
-- command line write no SQL. The country is the caller's: none is assumed.
-- ---------------------------------------------------------------------------

create or replace function create_project(
  p_organisation_id uuid,
  p_name            text,
  p_country         text,
  p_kind            text default 'study',
  p_start_date      date default null
)
returns uuid
language plpgsql
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if p_country is null or p_country !~ '^[A-Za-z]{2}$' then
    raise exception 'country_required: a project names the ISO 3166-1 alpha-2 country whose rules apply'
      using errcode = 'check_violation';
  end if;
  insert into projects (id, organisation_id, name, country, kind, start_date)
  values (v_id, p_organisation_id, p_name, upper(p_country), coalesce(p_kind, 'study'), p_start_date);
  return v_id;
end;
$$;

comment on function create_project(uuid, text, text, text, date) is
  'Opens a project in an organisation, in the country whose rules apply, of a kind of project_kinds. Refusals: country_required, and row level security for a caller who does not write the organisation.';

grant execute on function create_project(uuid, text, text, text, date) to authenticated, service_role;
