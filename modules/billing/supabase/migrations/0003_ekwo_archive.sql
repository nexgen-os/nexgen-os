-- Nexgen OS — module `billing`: its tables declared to Ekwo OS's company
-- archive.
--
-- Once `billing.reference_ekwo()` adds its foreign keys, three tables of the
-- module reach a company of Ekwo OS: `billing.organisations` through its
-- company, `billing.contacts` through its contact, `billing.invoices`
-- through its document. Ekwo OS writes no archive of a company — and so
-- applies no update, which archives first — while a table that reaches a
-- company is neither exported nor excluded (`unclassified_table`). Its
-- contract is a row per table in its `company_archive_registry`; the
-- `<schema>.archive_tables()` of a module is read only for Ekwo's own
-- modules.
--
-- The three tables are excluded: they are Nexgen OS's data, and stay with
-- it when a company leaves Ekwo OS; the Ekwo company, contact and document
-- they point at travel with the books. `billing.declare_to_ekwo_archive()`
-- writes the three rows into the registry, in the schema Ekwo OS lives in
-- (`billing.ekwo_table()`), and leaves a row already there as it is: a
-- classification written by hand, or Ekwo's own, is not overwritten.
-- Without Ekwo OS on the database it does nothing.
--
-- `billing.reference_ekwo()` calls it each time it runs, so that the keys
-- and the classification arrive together; this migration calls it once for
-- an installation already linked. Neither adds a key from a migration.

set search_path = nexgen, extensions;

create or replace function billing.declare_to_ekwo_archive()
returns text[]
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  v_registry text := billing.ekwo_table('company_archive_registry');
  declared   text[] := '{}';
begin
  if v_registry is null then
    return declared;
  end if;
  execute format($q$
    with declared as (
      insert into %s (table_schema, table_name, disposition, reason)
      values
        ('billing', 'organisations', 'excluded',
         'Nexgen OS billing data: the supplier organisation of the energy invoices. It belongs to Nexgen OS, which shares this database, and stays with it; an Ekwo archive carries the books.'),
        ('billing', 'contacts', 'excluded',
         'Nexgen OS billing data: the customer of the energy invoices, linked to its Ekwo contact. It belongs to Nexgen OS, which shares this database, and stays with it.'),
        ('billing', 'invoices', 'excluded',
         'Nexgen OS billing data: the energy invoice behind an Ekwo document. It belongs to Nexgen OS, which shares this database; the Ekwo document travels with the books.')
      on conflict (table_schema, table_name) do nothing
      returning table_schema || '.' || table_name as t
    )
    select coalesce(array_agg(t order by t), '{}') from declared$q$, v_registry)
    into declared;
  return declared;
end;
$$;

comment on function billing.declare_to_ekwo_archive() is
  'Declares the tables of the module that reach an Ekwo company (billing.organisations, billing.contacts, billing.invoices) to Ekwo OS''s company_archive_registry, in the schema Ekwo OS lives in, as excluded with their reason; a row already there is left as it is. Returns the tables it declared, none when Ekwo OS does not share the database. Called by billing.reference_ekwo().';

create or replace function billing.reference_ekwo()
returns text[]
language plpgsql
set search_path = nexgen, extensions, pg_temp
as $$
declare
  k     record;
  added text[] := '{}';
begin
  if not billing.ekwo_present() then
    return added;
  end if;
  for k in
    select t.tbl, t.name, t.col, billing.ekwo_table(t.target) as target, t.on_delete from (values
      ('billing.organisations', 'organisations_ekwo_company_fk', 'ekwo_company_id', 'companies', 'cascade'),
      ('billing.contacts', 'contacts_ekwo_contact_fk', 'ekwo_contact_id', 'contacts', 'set null'),
      ('billing.invoices', 'invoices_ekwo_invoice_fk', 'id', 'documents', 'cascade')
    ) as t (tbl, name, col, target, on_delete)
  loop
    continue when k.target is null
      or exists (select 1 from pg_constraint where conrelid = k.tbl::regclass and conname = k.name);
    execute format('alter table %s add constraint %I foreign key (%I) references %s (id) on delete %s not valid',
                   k.tbl, k.name, k.col, k.target, k.on_delete);
    begin
      execute format('alter table %s validate constraint %I', k.tbl, k.name);
    exception when foreign_key_violation then
      null;
    end;
    added := added || k.name;
  end loop;
  perform billing.declare_to_ekwo_archive();
  return added;
end;
$$;

comment on function billing.reference_ekwo() is
  'Adds the foreign keys from the Ekwo ids of the module to Ekwo OS''s companies, contacts and documents, in the schema Ekwo OS lives in, when Ekwo OS shares the database (ekwo_present()), and declares the tables they make reach a company to Ekwo''s company archive (billing.declare_to_ekwo_archive()); returns the keys it added, none otherwise. A key added before Ekwo OS moved its tables follows them and is not added again. Called by nexgen-os init and migrate, and by the installation after Ekwo OS is installed.';

revoke execute on function billing.declare_to_ekwo_archive() from public;

-- An installation already linked: its tables are declared now.
select billing.declare_to_ekwo_archive();
