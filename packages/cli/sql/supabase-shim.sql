-- What Supabase provides and a bare Postgres (or PGlite) does not: the
-- `auth` schema the migrations reference from their row level security
-- policies. It is applied BEFORE the migrations by the test harness and by
-- `nexgen-os try`, on a database in memory, and never on a real project,
-- where Supabase Auth owns it.

create schema if not exists auth;

-- Supabase's own user table, reduced to what the schema references. On a real
-- project GoTrue owns the full table; here we only need `id` to exist so the
-- foreign key from instance_admins resolves.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

-- GoTrue always puts the address in the JWT, so `auth.email()` reads the claim
-- on a real project. Here it falls back to the row, so a test does not have to
-- mint a token to be recognised by the address it signed up with.
create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid())
  );
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true));
$$;

-- Supabase's API roles, so `set role authenticated` works in the RLS tests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- The login PostgREST connects with, and the reason a test can reproduce
  -- what a request runs under. `set session authorization authenticator`
  -- drops the superuser of the session, so `set role authenticated` from
  -- `anon` is then allowed for the one reason it is allowed on a project:
  -- `authenticator` is a member of both. Checked against PostgreSQL 14 with a
  -- real `authenticator` login, which answers identically.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- Usage on `auth`, which is Supabase's schema and not Nexgen OS's to grant. Its
-- helpers are what every policy of the schema calls.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- And that is all this shim gives: what the API roles can reach in the tests
-- is exactly what a migration granted them.
