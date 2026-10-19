-- Nexgen OS — core: the kinds of object, and row level security everywhere.
--
-- An organisation is an object like any other (decision 36): it enters the
-- registry with its own id, so that attributes, identifiers, links and
-- documents attach to it — a default an organisation decides for all its
-- sites is an attribute of the organisation, read by `parameter_of()`. Its
-- object row names itself as organisation and belongs to no scenario.
--
-- `object_kinds` is a vocabulary: one row per kind of object, written by
-- `declare_object()` in migrations, read by everyone signed in. The last
-- statement checks that every table of the schema has row level security,
-- which `nexgen-os doctor` reports for an installation too.

set search_path = nexgen, public, extensions;

insert into object_kinds (kind, table_name, parent_columns, published_by)
values ('organisation', 'organisations', '{}', 'core');

-- Security definer: the creator becomes an owner in a trigger of the same
-- insert, and the registry row must not depend on which trigger runs first.
create or replace function register_organisation()
returns trigger
language plpgsql
security definer
set search_path = nexgen, public, extensions, pg_temp
as $$
begin
  insert into objects (id, kind, organisation_id, scenario_id)
  values (new.id, 'organisation', new.id, null);
  return new;
end;
$$;

comment on function register_organisation() is
  'AFTER INSERT on organisations: registers the organisation as an object of its own, so that attachments point to it.';

create trigger organisations_register
  after insert on organisations
  for each row execute function register_organisation();

alter table object_kinds enable row level security;
create policy object_kinds_read on object_kinds for select to authenticated using (true);
grant select on object_kinds to authenticated, service_role;

do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'nexgen' and c.relkind in ('r', 'p') and not c.relrowsecurity
       and c.relname not in ('schema_migrations') and not c.relispartition
  loop
    raise exception 'rls_disabled: nexgen.% has no row level security', t;
  end loop;
end
$$;
