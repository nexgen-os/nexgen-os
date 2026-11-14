-- Nexgen OS — core: an account is opened by an invitation.
--
-- Supabase Auth creates an account for whoever signs up, and an installation
-- that signs its people in by a code sent by email or text message needs
-- sign-ups open for the code to leave. Any signed-in person may then create
-- an organisation. `before_user_created(event)` is the hook Supabase Auth
-- calls before it creates an account ("Before User Created"): it lets in
-- the address an open invitation was sent to — a member, a share of a
-- project, the account of a participant — and refuses everybody else as
-- `invitation_required`. While nobody is a member of any organisation, the
-- installation's first person is let in, to create the first one.
--
-- The hook is the installation's choice: it does nothing until it is
-- enabled in Supabase Auth (Authentication → Hooks → Before User Created,
-- or `[auth.hook.before_user_created]` in config.toml), see docs/access.md.

set search_path = nexgen, extensions;

create or replace function before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if not exists (select 1 from organisation_members) then
    return '{}'::jsonb;
  end if;
  if v_email <> '' and exists (
       select 1 from invitations
        where email = v_email and accepted_at is null and revoked_at is null and expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'invitation_required: an account is opened by an invitation sent to its email address'));
end;
$$;

comment on function before_user_created(jsonb) is
  'The Before User Created hook of Supabase Auth: lets an account be created for an email address an open invitation was sent to (a member, a share of a project, the account of a participant), and for anybody while no organisation has a member yet; refuses every other sign-up as invitation_required, with the HTTP status 403. Called by Supabase Auth only, once the installation has enabled it.';

-- Supabase Auth calls the hook as `supabase_auth_admin`, and nobody else may.
revoke execute on function before_user_created(jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema nexgen to supabase_auth_admin;
    grant execute on function nexgen.before_user_created(jsonb) to supabase_auth_admin;
  end if;
end
$$;
