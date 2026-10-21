-- Nexgen OS — core: row level security everywhere.
--
-- An organisation is an object like any other (decision 36): attributes,
-- identifiers, links and documents attach to it as `('organisation', id)` —
-- a default an organisation decides for all its sites is an attribute of
-- the organisation, read by `parameter_of()` — and go with it when it is
-- deleted. The last statement checks that every table of the schema has row
-- level security, which `nexgen-os doctor` reports for an installation too.

set search_path = nexgen, public, extensions;

create trigger organisations_drop_attachments after delete on organisations
  for each row execute function drop_attachments('organisation');

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
