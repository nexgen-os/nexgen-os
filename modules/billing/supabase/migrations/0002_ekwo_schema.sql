-- Nexgen OS — module `billing`: Ekwo OS found where it lives.
--
-- Ekwo OS created its core in `public` and moved it to its own schema,
-- `ekwo`, in its 0.23.0 (its decision 0090, migration
-- `20261028040000_the_socle_moves_to_its_schema`). A database may hold it in
-- either place: `ekwo` from Ekwo OS 0.23, `public` from 0.17 to 0.22, and
-- `public` again while an older installation has not run the move. The
-- functions of 0001_billing named `public` for every Ekwo table, so on a
-- database where Ekwo OS lives in `ekwo` the module saw no Ekwo OS at all:
-- no foreign key, no legal number, no tax read from it.
--
-- The schema is found by Ekwo's own marker and never assumed, by the rule
-- Ekwo OS gives its own clients: its schema-version function,
-- `ekwo_schema_version()`, beside its `instance` table, looked for in `ekwo`
-- first, then in `public`, and in no other schema (`billing.ekwo_schema()`).
-- Every reader of an Ekwo table names the table in that schema
-- (`billing.ekwo_table()`). A table written `public.<name>`, as the
-- functions of 0001 pass it, is read as Ekwo's `<name>` wherever Ekwo lives,
-- the same reading Ekwo OS applies to the module files written before its
-- move; the functions that only pass a name on are left as 0001 wrote them.
--
-- The readers keep Ekwo's own search path for the layouts it has had —
-- `ekwo`, then `public` — because a helper of Ekwo's policies older than its
-- move resolves Ekwo's short names on the caller's path; every name they
-- write themselves is qualified.
--
-- Foreign keys added before Ekwo OS moved follow its tables: a move by
-- `alter … set schema` keeps them (`billing.reference_ekwo()` finds them by
-- name and adds none twice).

set search_path = nexgen, extensions;

-- The schema Ekwo OS lives in on this database, by its marker; null when
-- Ekwo OS does not share the database. A schema `ekwo` without the marker
-- (Ekwo OS 0.22 creates it empty, before the move) is not Ekwo OS's yet.
create or replace function billing.ekwo_schema()
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select v.s
    from (values (1, 'ekwo'), (2, 'public')) as v (o, s)
   where to_regprocedure(format('%I.ekwo_schema_version()', v.s)) is not null
     and to_regclass(format('%I.instance', v.s)) is not null
   order by v.o
   limit 1;
$$;

comment on function billing.ekwo_schema() is
  'The schema Ekwo OS lives in on this database — ekwo from Ekwo OS 0.23, public before — found by its own marker (ekwo_schema_version() beside its instance table), looked for in ekwo then public and never assumed; null when Ekwo OS does not share the database.';

-- An Ekwo table by its name, qualified in the schema Ekwo OS lives in; null
-- when Ekwo OS does not share the database or does not have that table.
create or replace function billing.ekwo_table(p_table text)
returns text
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select format('%I.%I', e.s, n.t)
    from billing.ekwo_schema() as e (s),
         (select regexp_replace(p_table, '^public\.', '') as t) as n
   where e.s is not null
     and to_regclass(format('%I.%I', e.s, n.t)) is not null;
$$;

comment on function billing.ekwo_table(text) is
  'An Ekwo OS table by its name (companies, or public.companies as the functions written before Ekwo OS moved name it), qualified in the schema Ekwo OS lives in (billing.ekwo_schema()); null when Ekwo OS does not share the database or has no such table.';

create or replace function billing.ekwo_present()
returns boolean
language sql
stable
set search_path = nexgen, extensions, pg_temp
as $$
  select billing.ekwo_schema() is not null;
$$;

comment on function billing.ekwo_present() is
  'Whether Ekwo OS shares the database, by its own marker in ekwo or in public (billing.ekwo_schema()), never by a table name another application may use.';

create or replace function billing.ekwo_row_exists(p_table text, p_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ekwo, public, pg_temp
as $$
declare
  v_table text := billing.ekwo_table(p_table);
  v_found boolean;
begin
  if v_table is null then
    return null;
  end if;
  execute format('select exists (select 1 from %s where id = $1)', v_table) into v_found using p_id;
  return v_found;
end;
$$;

comment on function billing.ekwo_row_exists(text, uuid) is
  'Whether a row of an Ekwo OS table (companies, contacts, documents, in the schema Ekwo OS lives in) has this id; null when Ekwo OS does not share the database.';

create or replace function billing.ekwo_identifiers(p_table text, p_id uuid)
returns table (scheme text, icd text, value text)
language plpgsql
stable
security invoker
set search_path = ekwo, public, pg_temp
as $$
declare
  v_name     text := regexp_replace(p_table, '^public\.', '');
  v_table    text := billing.ekwo_table(p_table);
  v_defaults text := billing.ekwo_table('country_defaults');
begin
  if v_name not in ('companies', 'contacts') or v_table is null or v_defaults is null then
    return;
  end if;
  return query execute format($q$
    with party as (
      select p.registration_number, p.vat_number, p.identifiers, cd.party_scheme, cd.vat_scheme
        from %s p
        left join %s cd on cd.country = %s
       where p.id = $1
    ),
    found (key, icd, value) as (
      select null::text, party.party_scheme::text, party.registration_number::text from party where party.registration_number is not null
      union all
      select null::text, party.vat_scheme::text, party.vat_number::text from party where party.vat_number is not null
      union all
      select e.key, null::text, e.value from party, jsonb_each_text(party.identifiers) e
    )
    select coalesce(s.code, f.key), coalesce(f.icd, s.icd), f.value
      from found f
      left join nexgen.identifier_schemes s on (f.icd is not null and s.icd = f.icd) or (f.icd is null and s.code = f.key)$q$,
    v_table, v_defaults, case when v_name = 'companies' then 'coalesce(p.fiscal_country, p.country)' else 'p.country' end)
  using p_id;
end;
$$;

comment on function billing.ekwo_identifiers(text, uuid) is
  'The legal numbers Ekwo OS holds for a company (companies) or a contact (contacts), in the schema Ekwo OS lives in: the registration number under its country''s party scheme, the VAT number under its VAT scheme (ISO 6523 codes of Ekwo''s country_defaults), and its identifiers by scheme; nothing when Ekwo OS does not share the database. Read under Ekwo''s row level security.';

create or replace function billing.ekwo_reach(p_ekwo_contact_id uuid)
returns table (email text, phone text)
language plpgsql
stable
security invoker
set search_path = ekwo, public, pg_temp
as $$
declare
  v_table text := billing.ekwo_table('contacts');
begin
  if v_table is null then
    return;
  end if;
  return query execute format('select c.email::text, c.phone::text from %s c where c.id = $1', v_table) using p_ekwo_contact_id;
end;
$$;

comment on function billing.ekwo_reach(uuid) is
  'The email and phone Ekwo OS holds for one of its contacts, in the schema Ekwo OS lives in, under its row level security; nothing when Ekwo OS does not share the database.';

create or replace function billing.ekwo_tax(p_company_id uuid, p_code text, p_on date)
returns table (id uuid, percent numeric)
language plpgsql
stable
security invoker
set search_path = ekwo, public, pg_temp
as $$
declare
  v_table text := billing.ekwo_table('taxes');
begin
  if v_table is null then
    return;
  end if;
  return query execute format('select t.id, %I.tax_rate_at(t.id, $3) from %s t where t.company_id = $1 and t.code = $2',
                              billing.ekwo_schema(), v_table)
    using p_company_id, p_code, p_on;
end;
$$;

comment on function billing.ekwo_tax(uuid, text, date) is
  'Ekwo OS''s tax of a code for a company, and its percentage on a day (its tax_rate_at()), in the schema Ekwo OS lives in; nothing when Ekwo OS does not share the database.';

create or replace function billing.ekwo_line_taxes(p_ekwo_invoice_id uuid)
returns table (line_id uuid, tax_id uuid)
language plpgsql
stable
security invoker
set search_path = ekwo, public, pg_temp
as $$
declare
  v_table text := billing.ekwo_table('document_lines');
begin
  if v_table is null then
    return;
  end if;
  return query execute format('select l.id, l.tax_id from %s l where l.document_id = $1 and l.line_type::text = $2', v_table)
    using p_ekwo_invoice_id, 'product';
end;
$$;

comment on function billing.ekwo_line_taxes(uuid) is
  'The tax of each product line of an Ekwo invoice, in the schema Ekwo OS lives in; nothing when Ekwo OS does not share the database.';

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
  return added;
end;
$$;

comment on function billing.reference_ekwo() is
  'Adds the foreign keys from the Ekwo ids of the module to Ekwo OS''s companies, contacts and documents, in the schema Ekwo OS lives in, when Ekwo OS shares the database (ekwo_present()); returns the keys it added, none otherwise. A key added before Ekwo OS moved its tables follows them and is not added again. Called by nexgen-os init and migrate, and by the installation after Ekwo OS is installed.';

create or replace function billing.unlinked_keys()
returns table (table_name text, id uuid, ekwo_id uuid)
language plpgsql
stable
set search_path = ekwo, public, pg_temp
as $$
declare
  v_companies text := billing.ekwo_table('companies');
  v_contacts  text := billing.ekwo_table('contacts');
  v_documents text := billing.ekwo_table('documents');
begin
  if v_companies is not null then
    return query execute format('select ''billing.organisations'', b.organisation_id, b.ekwo_company_id from billing.organisations b
                                  where not exists (select 1 from %s e where e.id = b.ekwo_company_id)', v_companies);
  end if;
  if v_contacts is not null then
    return query execute format('select ''billing.contacts'', b.id, b.ekwo_contact_id from billing.contacts b
                                  where b.ekwo_contact_id is not null and not exists (select 1 from %s e where e.id = b.ekwo_contact_id)', v_contacts);
  end if;
  if v_documents is not null then
    return query execute format('select ''billing.invoices'', b.id, b.id from billing.invoices b
                                  where not exists (select 1 from %s e where e.id = b.id)', v_documents);
  end if;
end;
$$;

comment on function billing.unlinked_keys() is
  'The rows of the module whose Ekwo id is not in Ekwo OS, when Ekwo OS shares the database, in the schema it lives in: table, row id, Ekwo id. Read by nexgen-os doctor (billing_key_unlinked).';

grant execute on function billing.ekwo_schema(), billing.ekwo_table(text) to authenticated, service_role;
