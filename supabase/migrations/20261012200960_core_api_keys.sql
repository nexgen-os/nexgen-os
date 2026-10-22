-- Nexgen OS — core: a key for a machine, which acts as the person who issued it.
--
-- Everything in this schema answers to `auth.uid()`, which comes from a JWT
-- the installation's own Supabase Auth issued. That is right for a person and
-- impossible for a script or an agent with no browser: a nightly import, an
-- MCP server operated for somebody. The two usual answers are both wrong:
-- the `service_role` key gives every organisation of the installation, and a
-- fake user puts a password in a crontab.
--
-- So a key is a delegation from a person, in the shape of the keys of Ekwo OS
-- (`api_keys`, `create_api_key()`, `revoke_api_key()`, `use_api_key()`), with
-- what the energy model needs instead of a company:
--
--   * it is issued on one organisation by a person who holds members.manage
--     on it, and reaches that organisation only — a project shared with its
--     issuer from another organisation stays out of its reach;
--   * it carries an explicit list of capabilities, codes of `capabilities`
--     (decision 0051), each held by its issuer when it is issued, and
--     row_has_capability() answers for it with that list on top of what its
--     issuer holds at the moment of the call; a key that holds only `.read`
--     capabilities runs every transaction it is presented in read only: the
--     database refuses the write, not a tool;
--   * it acts as its issuer: `use_api_key()` puts the issuer in the claims of
--     the transaction, so `auth.uid()` is that person and every policy binds
--     exactly as for them — a key is never wider than its issuer, and an
--     issuer who leaves the organisation takes their keys' reach with them;
--   * it expires when it is told to, is withdrawn by `revoke_api_key()`, and
--     is stored as its sha256 (Postgres' own `sha256()`, no extension) and
--     shown once, like an invitation token.
--
-- A key is presented at the top of a transaction by a client that holds a
-- connection: the MCP server and the command line (decision 0039). The
-- claims it sets are transaction-local, so nothing outlives the transaction.

set search_path = nexgen, extensions;

create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id) on delete cascade,
  name            text not null,
  -- The visible head of the secret, so a list of keys can be read by a human
  -- and a leaked secret can be matched to its row.
  prefix          text not null,
  key_hash        text not null unique,
  capabilities    text[] not null,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  constraint api_keys_name_not_blank check (btrim(name) <> ''),
  constraint api_keys_has_capability check (cardinality(capabilities) > 0),
  constraint api_keys_expiry check (expires_at is null or expires_at > created_at)
);

comment on table api_keys is
  'A key for a machine or an agent, issued on one organisation by a person who holds members.manage on it. It acts as its issuer under row level security, within that organisation and the capabilities on its list only, read only unless it carries a capability that writes. Hashed at rest and shown once. The shape of the api_keys of Ekwo OS.';
comment on column api_keys.prefix is
  'The readable head of the secret (ngk_<prefix>_…). It identifies a key without being one.';
comment on column api_keys.capabilities is
  'What the key may do: codes of capabilities (data.read, data.write…), each held by its issuer. A key holding only .read capabilities runs its transactions read only.';
comment on column api_keys.created_by is
  'auth.users.id of the person who issued it: the person the key acts as.';

create index api_keys_organisation_idx on api_keys (organisation_id, created_at desc);

-- Owners read the keys of their organisation, never the hash; nobody writes
-- the table but the gestures below.
alter table api_keys enable row level security;
create policy api_keys_select on api_keys for select to authenticated
  using (has_capability('organisation', organisation_id, 'members.manage'));
grant select (id, organisation_id, name, prefix, capabilities, created_by, created_at, expires_at, last_used_at, revoked_at)
  on api_keys to authenticated;
grant select, insert, update, delete on api_keys to service_role;

-- ---------------------------------------------------------------------------
-- The key of the transaction
-- ---------------------------------------------------------------------------

-- What `use_api_key()` put in the claims, or null for a person's own session.
create or replace function current_api_key_organisation()
returns uuid
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'api_key_organisation', '')::uuid;
$$;

comment on function current_api_key_organisation() is
  'The organisation the key presented in this transaction was issued on, null when the caller is a person''s own session.';

-- The reach of a key is read by row_has_capability() from the claims
-- use_api_key() sets: its organisation, and the capabilities on its list.

-- ---------------------------------------------------------------------------
-- Gestures
-- ---------------------------------------------------------------------------

create or replace function create_api_key(
  p_organisation_id uuid,
  p_name            text,
  p_capabilities    text[] default array['data.read'],
  p_expires_at      timestamptz default null
)
returns table (api_key_id uuid, secret text, prefix text, capabilities text[], expires_at timestamptz)
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_caps   text[] := coalesce(p_capabilities, '{}');
  v_prefix text := left(replace(gen_random_uuid()::text, '-', ''), 12);
  v_secret text;
  v_row    api_keys%rowtype;
begin
  if auth.uid() is null or not has_capability('organisation', p_organisation_id, 'members.manage') then
    raise exception 'not_allowed: a key is issued on an organisation by a person who holds members.manage on it'
      using errcode = '42501';
  end if;
  if current_api_key_organisation() is not null then
    raise exception 'not_allowed: a key does not issue keys; its issuer does, signed in'
      using errcode = '42501';
  end if;
  if cardinality(v_caps) = 0 then
    raise exception 'api_key_without_capability: name what the key may do, data.read or data.write';
  end if;
  if exists (select 1 from unnest(v_caps) c where c not in (select code from capabilities)) then
    raise exception 'unknown_capability: % is not a capability of this installation',
      (select string_agg(c, ', ') from unnest(v_caps) c where c not in (select code from capabilities));
  end if;
  -- A key is never wider than its issuer.
  if exists (select 1 from unnest(v_caps) c where not has_capability('organisation', p_organisation_id, c)) then
    raise exception 'capability_not_held: the issuer does not hold %',
      (select string_agg(c, ', ') from unnest(v_caps) c where not has_capability('organisation', p_organisation_id, c))
      using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'api_key_expiry_past: % is already past', p_expires_at;
  end if;
  v_secret := 'ngk_' || v_prefix || '_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into api_keys (organisation_id, name, prefix, key_hash, capabilities, created_by, expires_at)
  values (p_organisation_id, p_name, v_prefix, invitation_token_hash(v_secret), v_caps, auth.uid(), p_expires_at)
  returning * into v_row;
  return query select v_row.id, v_secret, v_row.prefix, v_row.capabilities, v_row.expires_at;
end;
$$;

comment on function create_api_key(uuid, text, text[], timestamptz) is
  'Issues a key on an organisation, acting as the person who issues it (members.manage), with capabilities that person holds, and returns the secret once. Only its sha256 is kept. Refusals: not_allowed, api_key_without_capability, unknown_capability, capability_not_held, api_key_expiry_past.';

create or replace function list_api_keys(p_organisation_id uuid)
returns table (id uuid, name text, prefix text, capabilities text[], created_by uuid, created_at timestamptz,
               expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
stable
security invoker
set search_path = nexgen, extensions, pg_temp
as $$
  select k.id, k.name, k.prefix, k.capabilities, k.created_by, k.created_at, k.expires_at, k.last_used_at, k.revoked_at
    from api_keys k
   where k.organisation_id = p_organisation_id
   order by k.created_at desc;
$$;

comment on function list_api_keys(uuid) is
  'The keys of an organisation, as whoever holds members.manage sees them: never the secret, never its hash.';

create or replace function revoke_api_key(p_api_key_id uuid)
returns void
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from api_keys where id = p_api_key_id;
  if v_org is null or not has_capability('organisation', v_org, 'members.manage') then
    raise exception 'api_key_unknown: no key % on an organisation you manage', p_api_key_id
      using errcode = 'P0002';
  end if;
  update api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_api_key_id;
end;
$$;

comment on function revoke_api_key(uuid) is
  'Withdraws a key, at once and for good. Revoking twice keeps the first date.';

-- Presents a key at the top of a transaction: checks it, records the use,
-- and acts as its issuer until the transaction ends.
create or replace function use_api_key(p_secret text)
returns table (api_key_id uuid, organisation_id uuid, acts_as uuid, capabilities text[])
language plpgsql
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k api_keys%rowtype;
begin
  select * into k from api_keys where key_hash = invitation_token_hash(coalesce(p_secret, ''));
  if k.id is null then
    raise exception 'api_key_unknown: this key was not issued by this installation' using errcode = '28000';
  end if;
  if k.revoked_at is not null then
    raise exception 'api_key_revoked: the key % was withdrawn on %', k.prefix, k.revoked_at using errcode = '28000';
  end if;
  if k.expires_at is not null and k.expires_at <= now() then
    raise exception 'api_key_expired: the key % expired on %', k.prefix, k.expires_at using errcode = '28000';
  end if;
  if not exists (select 1 from organisation_members m where m.organisation_id = k.organisation_id and m.user_id = k.created_by) then
    raise exception 'api_key_issuer_left: the person who issued the key % is no longer a member of its organisation', k.prefix
      using errcode = '28000';
  end if;
  update api_keys set last_used_at = now() where id = k.id;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', k.created_by, 'role', 'authenticated',
    'api_key_id', k.id, 'api_key_organisation', k.organisation_id, 'api_key_capabilities', to_jsonb(k.capabilities)
  )::text, true);
  if not exists (select 1 from unnest(k.capabilities) c where c not like '%.read') then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  return query select k.id, k.organisation_id, k.created_by, k.capabilities;
end;
$$;

comment on function use_api_key(text) is
  'Presents a key for the rest of the transaction: refuses an unknown, revoked or expired key and one whose issuer left (api_key_unknown, api_key_revoked, api_key_expired, api_key_issuer_left), records the use, puts the issuer in the claims (auth.uid() is that person, within the key''s organisation), and makes the transaction read only for a key that holds only .read capabilities.';

revoke all on function create_api_key(uuid, text, text[], timestamptz), list_api_keys(uuid),
  revoke_api_key(uuid), use_api_key(text) from public;
grant execute on function create_api_key(uuid, text, text[], timestamptz), list_api_keys(uuid),
  revoke_api_key(uuid) to authenticated, service_role;
grant execute on function use_api_key(text), current_api_key_organisation() to anon, authenticated, service_role;
