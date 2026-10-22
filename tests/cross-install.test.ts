// Nexgen OS and Ekwo OS installed on one database, in both orders.
//
// Ekwo OS, the invoicing and bookkeeping core built on the same playbook,
// lives in `public`; Nexgen OS lives in `nexgen` and one schema per module
// (decision 0010). This file installs both on one PGlite with PostGIS, each by its own installer —
// Ekwo's migration runner from the published `ekwo-os` package, which carries
// its migrations, and `nexgen-os init` — and checks that neither touches what
// the other created: no name collides, each side keeps its schemas, Ekwo's
// revocations on `public` leave Nexgen OS's grants as they were, a person who
// belongs to both sides reads both, and the `billing` module points at an
// Ekwo company, contact and invoice by real foreign keys. Ekwo OS needs no
// extension, so all of it runs on PGlite; what it leaves to a real project
// is in `docs/with-ekwo-os.md`.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ekwo from 'ekwo-os';
import { doctor, install } from '../packages/cli/src/index.js';
import { asUser, emptyDatabase, one, repoRoot, sqlClient, USER_A, USER_B } from './helpers/db.js';

const NEXGEN_SCHEMAS = ['nexgen', 'billing'];
const EKWO_SCHEMAS = ['public', 'supabase_migrations'];

/**
 * A Supabase project as both installers find it: the roles and `auth` of the
 * shim, PostGIS in `extensions` as Supabase places it, and the API roles
 * allowed to use that schema.
 */
async function project(): Promise<PGlite> {
  return emptyDatabase();
}

/** Ekwo's runner wants transactions; PGlite gives them. */
function ekwoClient(db: PGlite | Parameters<Parameters<PGlite['transaction']>[0]>[0]): ekwo.SqlClient {
  return {
    async exec(sql) {
      await db.exec(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows;
    },
    async transaction<T>(fn: (tx: ekwo.SqlClient) => Promise<T>) {
      return (db as PGlite).transaction((tx) => fn(ekwoClient(tx)));
    },
    async close() {},
  };
}

/** Each installer opens its own connection: nothing of the other's session survives. */
async function newSession(db: PGlite) {
  await db.exec('reset all');
}

async function installEkwo(db: PGlite) {
  await newSession(db);
  const migrations = await ekwo.listMigrations(ekwo.migrationsDir());
  await ekwo.applyMigrations(ekwoClient(db), migrations);
}

async function installNexgen(db: PGlite) {
  await newSession(db);
  await install(sqlClient(db), { root: repoRoot, modules: ['billing'], packs: [] });
}

/**
 * Every named thing outside the system schemas, as `kind schema.name`:
 * schemas, relations (tables, views, sequences, indexes: one namespace),
 * functions with their arguments, and types that are not the row type of a
 * table. Objects that belong to an extension are the platform's, not left
 * out by accident: PostGIS sits in `extensions`. Read on an empty search
 * path, so that every type in an argument list is written with its schema.
 */
async function objects(db: PGlite): Promise<Set<string>> {
  await db.exec('set search_path = pg_catalog');
  const { rows } = await db.query<{ o: string }>(`
    with own as (
      select n.oid, n.nspname from pg_namespace n
       where n.nspname not like 'pg\\_%' and n.nspname not in ('information_schema', 'auth', 'extensions')
    ),
    ext as (select objid from pg_depend where deptype = 'e')
    select 'schema ' || nspname as o from own
    union all
    select 'relation ' || own.nspname || '.' || c.relname
      from pg_class c join own on own.oid = c.relnamespace
     where c.oid not in (select objid from ext) and c.relkind <> 't'
    union all
    select 'function ' || own.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join own on own.oid = p.pronamespace
     where p.oid not in (select objid from ext)
    union all
    select 'type ' || own.nspname || '.' || t.typname
      from pg_type t join own on own.oid = t.typnamespace
     where t.oid not in (select objid from ext) and t.typrelid = 0 and t.typcategory <> 'A'
  `);
  return new Set(rows.map((r) => r.o));
}

/** The rights on every object of the given schemas, and on the schemas themselves. */
async function grants(db: PGlite, schemas: string[]): Promise<Record<string, string>> {
  await db.exec('set search_path = pg_catalog');
  const { rows } = await db.query<{ o: string; acl: string }>(
    `select 'schema ' || n.nspname as o, coalesce(n.nspacl::text, '') as acl
       from pg_namespace n where n.nspname = any($1)
     union all
     select 'relation ' || n.nspname || '.' || c.relname, coalesce(c.relacl::text, '')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'S')
     union all
     select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
            coalesce(p.proacl::text, '')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)
     union all
     select 'default ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text, d.defaclacl::text
       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = any($1) or d.defaclnamespace = 0`,
    [schemas],
  );
  return Object.fromEntries(rows.map((r) => [r.o, r.acl]));
}

const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));
const schemaOf = (o: string) => (o.startsWith('schema ') ? o.slice(7) : o.split(' ')[1].split('.')[0]);
const nameOf = (o: string) => `${o.split(' ')[0]} ${o.split(' ')[1].split('.').slice(1).join('.')}`;

interface Side {
  ekwo: Set<string>;
  nexgen: Set<string>;
}

/** Installs both in the given order; returns the database and what each side created. */
async function both(order: 'ekwo-first' | 'nexgen-first') {
  const db = await project();
  const base = await objects(db);
  const side: Side = { ekwo: new Set(), nexgen: new Set() };
  let before: Record<string, string> = {};
  let after: Record<string, string> = {};
  let doctorBefore: unknown;
  let doctorAfter: unknown;
  const ekwoDoctor = async () => {
    await newSession(db);
    return (await ekwo.doctor(ekwoClient(db), await ekwo.listMigrations(ekwo.migrationsDir()))).checks
      .map((c) => `${c.severity} ${c.name}`)
      .sort();
  };
  const nexgenDoctor = async () => {
    await newSession(db);
    return (await doctor(sqlClient(db))).problems.map((p) => p.code).sort();
  };
  if (order === 'ekwo-first') {
    await installEkwo(db);
    const mid = await objects(db);
    side.ekwo = minus(mid, base);
    before = await grants(db, EKWO_SCHEMAS);
    doctorBefore = await ekwoDoctor();
    await installNexgen(db);
    side.nexgen = minus(await objects(db), mid);
    after = await grants(db, EKWO_SCHEMAS);
    doctorAfter = await ekwoDoctor();
  } else {
    await installNexgen(db);
    const mid = await objects(db);
    side.nexgen = minus(mid, base);
    before = await grants(db, NEXGEN_SCHEMAS);
    doctorBefore = await nexgenDoctor();
    await installEkwo(db);
    side.ekwo = minus(await objects(db), mid);
    after = await grants(db, NEXGEN_SCHEMAS);
    doctorAfter = await nexgenDoctor();
  }
  const all = await objects(db);
  await newSession(db);
  await db.exec('set search_path = nexgen, public, extensions');
  return { db, side, all, before, after, doctorBefore, doctorAfter };
}

type Order = 'ekwo-first' | 'nexgen-first';
type Run = Omit<Awaited<ReturnType<typeof both>>, 'db'>;
const runs: Partial<Record<Order, Run>> = {};

// One database at a time: each order is built, read and closed before the next.
describe.each<Order>(['ekwo-first', 'nexgen-first'])('Nexgen OS and Ekwo OS on one database, %s', (order) => {
  let db: PGlite;
  let run: Run;

  beforeAll(async () => {
    const { db: built, ...read } = await both(order);
    db = built;
    run = runs[order] = read;
  }, 300_000);

  afterAll(async () => {
    await db?.close();
  });

  it('public holds only Ekwo, nexgen and its module schemas only Nexgen OS', () => {
    const { ekwo: e, nexgen: n } = run.side;
    expect(e.size).toBeGreaterThan(500);
    expect(n.size).toBeGreaterThan(150);
    expect(new Set([...n].map(schemaOf))).toEqual(new Set(NEXGEN_SCHEMAS));
    expect([...e].filter((o) => !EKWO_SCHEMAS.includes(schemaOf(o)))).toEqual([]);
    for (const o of run.all) {
      if (EKWO_SCHEMAS.includes(schemaOf(o))) expect(e.has(o) || o === 'schema public', o).toBe(true);
      if (NEXGEN_SCHEMAS.includes(schemaOf(o))) expect(n.has(o), o).toBe(true);
    }
  });

  it("the second installation leaves the grants of the first as they were", () => {
    // Ekwo first: Ekwo's rights on public; Nexgen OS first: Nexgen OS's on nexgen
    // and billing, through every revocation Ekwo makes on public.
    expect(Object.keys(run.before).length).toBeGreaterThan(100);
    expect(run.after).toEqual(run.before);
  });

  it("the first one's doctor reads the same after the second installation", () => {
    expect(run.doctorAfter).toEqual(run.doctorBefore);
  });

  describe('a member of both sides', () => {
    let organisationId: string;
    let companyId: string;

    beforeAll(async () => {
      await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
      organisationId = (await one<{ id: string }>(db, `insert into nexgen.organisations (name) values ('Cooperative') returning id`)).id;
      await db.query(`insert into nexgen.organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [organisationId, USER_A]);
      companyId = (
        await one<{ id: string }>(
          db,
          `insert into public.companies (name, country, fiscal_country, currency_code, language)
           values ('Cooperative', 'BE', 'BE', 'EUR', 'fr') returning id`,
        )
      ).id;
      await db.query(`insert into public.company_members (company_id, user_id, role) values ($1, $2, 'owner')`, [companyId, USER_A]);
    });

    it('keeps one list of currencies: the core seeds the rows Ekwo OS seeds, and XXX', async () => {
      // Ekwo's own seed, as its installer writes it.
      await db.exec(`set search_path = public; ${await readFile(join(ekwo.migrationsDir(), '..', 'seed', '00_currencies.sql'), 'utf8')}; reset search_path`);
      const rows = async (schema: string) =>
        (await db.query<{ r: string }>(`select format('%s|%s|%s|%s|%s', code, name, symbol, decimal_places, active) r from ${schema}.currencies where code <> 'XXX' order by code`)).rows.map((x) => x.r);
      const [ours, theirs] = [await rows('nexgen'), await rows('public')];
      expect(ours.length).toBeGreaterThan(50);
      expect(ours).toEqual(theirs);
    });

    it('reads its organisation in nexgen and its company in public', async () => {
      const seen = await asUser(db, USER_A, async () => ({
        organisations: (await db.query<{ name: string }>('select name from nexgen.organisations')).rows,
        companies: (await db.query<{ name: string }>('select name from public.companies')).rows,
      }));
      expect(seen).toEqual({ organisations: [{ name: 'Cooperative' }], companies: [{ name: 'Cooperative' }] });
      const stranger = await asUser(db, USER_B, async () => ({
        organisations: (await db.query('select 1 from nexgen.organisations')).rows.length,
        companies: (await db.query('select 1 from public.companies')).rows.length,
      }));
      expect(stranger).toEqual({ organisations: 0, companies: 0 });
    });

    it('links the organisation to its Ekwo company through billing.organisations', async () => {
      await asUser(db, USER_A, () =>
        db.query('insert into billing.organisations (organisation_id, ekwo_company_id) values ($1, $2)', [organisationId, companyId]),
      );
      const joined = await asUser(db, USER_A, () =>
        db.query<{ organisation: string; company: string }>(
          `select o.name as organisation, c.name as company
             from billing.organisations a
             join nexgen.organisations o on o.id = a.organisation_id
             join public.companies c on c.id = a.ekwo_company_id`,
        ),
      );
      expect(joined.rows).toEqual([{ organisation: 'Cooperative', company: 'Cooperative' }]);
    });

    it('takes real foreign keys to public.companies, public.contacts and public.documents', async () => {
      const keys = async () =>
        (
          await db.query<{ k: string }>(
            `select n.nspname || '.' || t.relname || ' ' || fn.nspname || '.' || f.relname || ' ' || c.convalidated as k
               from pg_constraint c
               join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
               join pg_class f on f.oid = c.confrelid join pg_namespace fn on fn.oid = f.relnamespace
              where n.nspname = 'billing' and c.contype = 'f' and fn.nspname = 'public' order by 1`,
          )
        ).rows.map((r) => r.k);
      // Ekwo first: the module's migration added them. Nexgen OS first: the
      // installation adds them once Ekwo OS is there.
      const added = (await one<{ k: string[] }>(db, 'select billing.reference_ekwo() k')).k;
      expect(added).toEqual(order === 'ekwo-first' ? [] : ['organisations_ekwo_company_fk', 'contacts_ekwo_contact_fk', 'invoices_ekwo_invoice_fk']);
      expect(await keys()).toEqual([
        'billing.contacts public.contacts true',
        'billing.invoices public.documents true',
        'billing.organisations public.companies true',
      ]);
      await expect(
        db.query('update billing.organisations set ekwo_company_id = gen_random_uuid() where organisation_id = $1', [organisationId]),
      ).rejects.toThrow(/foreign key/);
    });

    describe('a participant billed in Ekwo', () => {
      let participantId: string;
      let documentId: string;

      beforeAll(async () => {
        const contactId = (await one<{ id: string }>(db, `insert into nexgen.contacts (organisation_id, name) values ($1, 'Warehouse tenant') returning id`, [organisationId])).id;
        const projectId = (
          await one<{ id: string }>(db, `insert into nexgen.projects (organisation_id, name, kind, country) values ($1, 'Harbour community', 'energy_community', 'BE') returning id`, [organisationId])
        ).id;
        participantId = (
          await one<{ id: string }>(
            db,
            `insert into nexgen.participants (organisation_id, project_id, name, contact_id, status) values ($1, $2, 'Warehouse', $3, 'active') returning id`,
            [organisationId, projectId, contactId],
          )
        ).id;
        // Ekwo's own functions read its tables on its own search path.
        await db.exec('set search_path = public, extensions');
        // The currency of the company, as Ekwo's seed would declare it.
        await db.query(`insert into public.currencies (code, name) values ('EUR', 'Euro') on conflict do nothing`);
        const ekwoContactId = (await one<{ id: string }>(db, `insert into public.contacts (company_id, name) values ($1, 'Warehouse tenant') returning id`, [companyId])).id;
        documentId = (
          await one<{ id: string }>(
            db,
            `insert into public.documents (company_id, doc_type, contact_id, document_date) values ($1, 'sale_invoice', $2, '2026-06-01') returning id`,
            [companyId, ekwoContactId],
          )
        ).id;
        await db.exec('set search_path = nexgen, public, extensions');
        await asUser(db, USER_A, () => db.query('select billing.link_contact($1, $2)', [contactId, ekwoContactId]));
      });

      it('records the Ekwo invoice of the participant, and refuses one Ekwo does not hold', async () => {
        await asUser(db, USER_A, () =>
          db.query(`select billing.record_invoice($1, $2, 'sale', '2026-05-01', '2026-05-31')`, [participantId, documentId]),
        );
        const joined = await asUser(db, USER_A, () =>
          db.query<{ participant: string; doc_type: string }>(
            `select p.name as participant, d.doc_type::text as doc_type
               from billing.invoices_of($1) i
               join nexgen.participants p on p.id = i.participant_id
               join public.documents d on d.id = i.id`,
            [participantId],
          ),
        );
        expect(joined.rows).toEqual([{ participant: 'Warehouse', doc_type: 'sale_invoice' }]);
        await expect(
          asUser(db, USER_A, () => db.query(`select billing.record_invoice($1, gen_random_uuid(), 'sale', '2026-06-01', '2026-06-30')`, [participantId])),
        ).rejects.toThrow(/^ekwo_invoice_not_found/);
        await expect(
          asUser(db, USER_A, () => db.query('select billing.link_organisation($1, gen_random_uuid())', [organisationId])),
        ).rejects.toThrow(/^ekwo_company_not_found/);
      });

      it("nexgen-os doctor names a row whose Ekwo id is not in Ekwo OS", async () => {
        expect((await doctor(sqlClient(db))).problems.map((p) => p.code)).not.toContain('billing_key_unlinked');
        // A row left dangling as a restore without its foreign keys leaves it.
        const dangling = '00000000-0000-4000-8000-0000000000dd';
        await db.exec('set session_replication_role = replica');
        await db.query(`insert into billing.invoices (id, organisation_id, participant_id, kind, period_from, period_to) values ($1, $2, $3, 'sale', '2026-06-01', '2026-06-30')`, [dangling, organisationId, participantId]);
        await db.exec('set session_replication_role = origin');
        const unlinked = (await doctor(sqlClient(db))).problems.filter((p) => p.code === 'billing_key_unlinked');
        expect(unlinked).toEqual([{ code: 'billing_key_unlinked', detail: `billing.invoices ${dangling}: Ekwo id ${dangling} is not in Ekwo OS` }]);
        await db.query('delete from billing.invoices where id = $1', [dangling]);
        await db.exec('set search_path = nexgen, public, extensions');
      });
    });

    describe('one source for each fact', () => {
      let place: string;

      beforeAll(async () => {
        // The pack of the country and the module it needs, as a later `nexgen-os init` adds them.
        await newSession(db);
        await install(sqlClient(db), { root: repoRoot, modules: ['billing', 'grid'], packs: ['be'] });
        await db.exec('set search_path = public, extensions');
        // What Ekwo's pack for Belgium sets for the country (packs/be/pack.json, `einvoicing` and `defaults.roles`).
        await db.query(`insert into public.country_defaults (country, name, currency_code, receivable_code, payable_code, party_scheme, vat_scheme)
                        values ('BE', 'Belgium', 'EUR', '400000', '440000', '0208', '9925')
                        on conflict (country) do update set party_scheme = excluded.party_scheme, vat_scheme = excluded.vat_scheme`);
        await db.exec('set search_path = nexgen, public, extensions');
        const projectId = (await one<{ id: string }>(db, `select id from nexgen.projects where organisation_id = $1`, [organisationId])).id;
        place = (await one<{ id: string }>(db,
          `insert into nexgen.participants (organisation_id, project_id, name, country, status) values ($1, $2, 'Bakery', 'BE', 'active') returning id`,
          [organisationId, projectId])).id;
      }, 300_000);

      const ekwoCompany = async (name: string, registration: string) =>
        (await one<{ id: string }>(db,
          `insert into public.companies (name, country, fiscal_country, currency_code, language, registration_number, vat_number)
           values ($1, 'BE', 'BE', 'EUR', 'fr', $2, 'BE' || regexp_replace($2, '[^0-9]', '', 'g')) returning id`, [name, registration])).id;
      const nexgenOrganisation = async (name: string, enterpriseNumber: string) => {
        const id = (await one<{ id: string }>(db, `insert into nexgen.organisations (name) values ($1) returning id`, [name])).id;
        await db.query(`select nexgen.add_identifier('organisation', $1, 'enterprise_number', $2)`, [id, enterpriseNumber]);
        return id;
      };

      it('reads the legal numbers of a linked organisation from Ekwo OS, by their ISO 6523 code, and keeps none of its own', async () => {
        const org = await nexgenOrganisation('Bakers union', '0123456749');
        const company = await ekwoCompany('Bakers union', '0123.456.749');
        expect((await db.query('select * from billing.legal_identifiers($1, $2)', ['organisation', org])).rows)
          .toEqual([{ scheme: 'enterprise_number', icd: '0208', value: '0123456749', held_by: 'nexgen' }]);
        await db.query('select billing.link_organisation($1, $2)', [org, company]);
        // The same number, written with dots in Ekwo: it is Ekwo's now, and only Ekwo's.
        expect((await db.query('select * from billing.legal_identifiers($1, $2)', ['organisation', org])).rows).toEqual([
          { scheme: 'enterprise_number', icd: '0208', value: '0123.456.749', held_by: 'ekwo' },
          { scheme: null, icd: '9925', value: 'BE0123456749', held_by: 'ekwo' },
        ]);
        expect((await db.query(`select 1 from nexgen.identifiers where object_id = $1`, [org])).rows).toEqual([]);
        // A number Ekwo does not hold is written there first.
        const other = await nexgenOrganisation('Millers union', '0111111119');
        await expect(db.query('select billing.link_organisation($1, $2)', [other, await ekwoCompany('Millers union', '0222.222.228')]))
          .rejects.toThrow(/^legal_identifier_conflict: enterprise_number 0111111119 \(ISO 6523 0208\)/);
        // Written again after the link, it is named by the doctor.
        await db.query(`select nexgen.add_identifier('organisation', $1, 'enterprise_number', '0123456749')`, [org]);
        expect((await db.query('select table_name, what from billing.held_twice()')).rows).toEqual([{ table_name: 'nexgen.identifiers', what: 'enterprise_number 0123456749' }]);
        expect((await doctor(sqlClient(db))).problems.map((p) => p.code)).toContain('billing_held_twice');
        await db.query(`delete from nexgen.identifiers where object_id = $1`, [org]);
        await db.exec('set search_path = nexgen, public, extensions');
      });

      it('reads how a linked contact is reached from Ekwo OS, and keeps it here only while it is not linked', async () => {
        const desk = (await one<{ id: string }>(db, `insert into nexgen.contacts (organisation_id, name) values ($1, 'Bakery desk') returning id`, [organisationId])).id;
        await db.query(`insert into billing.contacts (id, email, phone) values ($1, 'desk@example.org', '+00 0 000 00 00')`, [desk]);
        expect(await one(db, 'select * from billing.reach_of($1)', [desk])).toEqual({ email: 'desk@example.org', phone: '+00 0 000 00 00', held_by: 'nexgen' });
        const theirs = (await one<{ id: string }>(db,
          `insert into public.contacts (company_id, name, email, phone) values ($1, 'Bakery desk', 'Desk@example.org', '+00 0 000 00 00') returning id`, [companyId])).id;
        await asUser(db, USER_A, () => db.query('select billing.link_contact($1, $2)', [desk, theirs]));
        expect(await one(db, 'select email, phone from billing.contacts where id = $1', [desk])).toEqual({ email: null, phone: null });
        // One reading function, under each side's row level security.
        expect(await asUser(db, USER_A, () => one(db, 'select * from billing.reach_of($1)', [desk])))
          .toEqual({ email: 'Desk@example.org', phone: '+00 0 000 00 00', held_by: 'ekwo' });
        await db.query(`update public.contacts set email = 'orders@example.org' where id = $1`, [theirs]);
        expect((await one<{ email: string }>(db, 'select email from billing.reach_of($1)', [desk])).email).toBe('orders@example.org');
        await expect(db.query(`update billing.contacts set email = 'desk@example.org' where id = $1`, [desk])).rejects.toThrow(/^contact_reach_held_by_ekwo/);
        // A reach Ekwo does not hold is written there first.
        const counter = (await one<{ id: string }>(db, `insert into nexgen.contacts (organisation_id, name) values ($1, 'Counter') returning id`, [organisationId])).id;
        await db.query(`insert into billing.contacts (id, email) values ($1, 'counter@example.org')`, [counter]);
        await expect(db.query('select billing.link_contact($1, $2)', [counter, theirs])).rejects.toThrow(/^contact_reach_conflict: email counter@example.org/);
        // A row written before Ekwo OS came beside it is named by the doctor.
        await db.exec('set session_replication_role = replica');
        await db.query(`update billing.contacts set phone = '+00 0 000 00 01' where id = $1`, [desk]);
        await db.exec('set session_replication_role = origin');
        expect((await db.query('select table_name, id, what from billing.held_twice()')).rows).toEqual([{ table_name: 'billing.contacts', id: desk, what: 'phone' }]);
        await db.query(`update billing.contacts set phone = null where id = $1`, [desk]);
        await db.exec('set search_path = nexgen, public, extensions');
      });

      describe('a settlement invoiced in Ekwo', () => {
        let reduced: string;
        let standard: string;
        let account: string;
        let customer: string;

        beforeAll(async () => {
          await db.exec('set search_path = public, extensions');
          // Two sale taxes of Ekwo's pack for Belgium (packs/be/taxes.json), as its installation writes them for a company.
          reduced = (await one<{ id: string }>(db,
            `insert into public.taxes (company_id, code, name, amount, applies_to, country, vat_category, valid_from, legal_reference)
             values ($1, 'BE-S-06', 'Vente 6 %', 6, 'sale', 'BE', 'S', '1996-01-01', 'AR n. 20, tableau A') returning id`, [companyId])).id;
          standard = (await one<{ id: string }>(db,
            `insert into public.taxes (company_id, code, name, amount, applies_to, country, vat_category, valid_from, legal_reference)
             values ($1, 'BE-S-21', 'Vente 21 %', 21, 'sale', 'BE', 'S', '1996-01-01', 'AR n. 20, art. 1') returning id`, [companyId])).id;
          account = (await one<{ id: string }>(db, `insert into public.accounts (company_id, code, name, account_type) values ($1, '700000', 'Sales', 'income') returning id`, [companyId])).id;
          customer = (await one<{ id: string }>(db, `insert into public.contacts (company_id, name) values ($1, 'Bakery') returning id`, [companyId])).id;
          await db.exec('set search_path = nexgen, public, extensions');
          await db.query(`update nexgen.participants set contact_id = (select contact_id from nexgen.participants where name = 'Warehouse' and organisation_id = $1) where id = $2`, [organisationId, place]);
        });

        const invoice = async (taxId: string) => {
          await db.exec('set search_path = public, extensions');
          const id = (await one<{ id: string }>(db,
            `insert into public.documents (company_id, doc_type, contact_id, document_date) values ($1, 'sale_invoice', $2, '2026-06-01') returning id`, [companyId, customer])).id;
          await db.query(`insert into public.document_lines (document_id, company_id, name, quantity, unit_price, tax_id, account_id)
                          values ($1, $2, 'Energy shared in May', 1200, 0.1, $3, $4)`, [id, companyId, taxId, account]);
          await db.exec('set search_path = nexgen, public, extensions');
          return id;
        };

        it("takes Ekwo's tax by the code the pack names beside its rate, never the pack's rate", async () => {
          // The pack keeps the rate as a ratio, for simulation, and names the Ekwo tax it mirrors.
          expect(await one(db, `select nexgen.parameter_of('participant', $1, 'vat_code_electricity', '2026-05-31')->'value' code`, [place])).toEqual({ code: 'BE-S-06' });
          const tax = await one(db, `select tax_code, rate::float8 rate, ekwo_tax_id, held_by from billing.tax_of($1, '2026-05-31')`, [place]);
          expect(tax).toEqual({ tax_code: 'BE-S-06', rate: 0.06, ekwo_tax_id: reduced, held_by: 'ekwo' });
          // A tax Ekwo does not have in force that day is refused, not replaced by the pack's rate, which holds.
          await db.query(`update public.taxes set valid_to = '2026-04-30' where id = $1`, [reduced]);
          await expect(db.query(`select * from billing.tax_of($1, '2026-05-31')`, [place])).rejects.toThrow(/^ekwo_tax_not_in_force: tax BE-S-06/);
          await db.query(`update public.taxes set valid_to = null where id = $1`, [reduced]);
        });

        it("records the invoice of a settlement taxed by Ekwo's tax of that code, at Ekwo's rate, and refuses another", async () => {
          const settlement = (await one<{ id: string }>(db, 'select gen_random_uuid() id')).id;
          const right = await invoice(reduced);
          await db.query(`select billing.record_invoice($1, $2, 'sale', '2026-05-01', '2026-05-31', null, $3)`, [place, right, settlement]);
          const amounts = await one<{ untaxed: number; tax: number }>(db, 'select amount_untaxed::float8 untaxed, amount_tax::float8 tax from public.documents where id = $1', [right]);
          expect(amounts).toEqual({ untaxed: 120, tax: 7.2 });
          const wrong = await invoice(standard);
          await expect(db.query(`select billing.record_invoice($1, $2, 'sale', '2026-05-01', '2026-05-31', null, $3)`, [place, wrong, settlement]))
            .rejects.toThrow(/^invoice_tax_mismatch: a line of Ekwo invoice .* is not taxed by BE-S-06/);
        });
      });
    });
  });
});

describe('Nexgen OS and Ekwo OS, whichever installs first', () => {
  const sides = () => [runs['ekwo-first']!.side, runs['nexgen-first']!.side];
  const run = () => runs['nexgen-first']!;

  it('each side creates the same objects in both orders', () => {
    const [a, b] = sides();
    expect([...a.ekwo].sort()).toEqual([...b.ekwo].sort());
    expect([...a.nexgen].sort()).toEqual([...b.nexgen].sort());
  });

  it('no schema, table, function or type is created by both', () => {
    const [{ ekwo: e, nexgen: n }] = sides();
    expect([...e].filter((o) => n.has(o))).toEqual([]);
  });

  it('module schemas of both releases are disjoint, and none of Nexgen OS is named ekwo', async () => {
    const created = async (dir: string) => {
      const names = new Set<string>();
      for (const f of await readdir(dir, { recursive: true })) {
        if (!f.endsWith('.sql')) continue;
        for (const m of (await readFile(join(dir, f), 'utf8')).matchAll(/^create schema (?:if not exists )?([a-z_][a-z0-9_]*)/gm)) names.add(m[1]);
      }
      return names;
    };
    const ekwoModules = await created(join(ekwo.resolveBundleDir(), 'modules'));
    const nexgenModules = await created(join(repoRoot, 'modules'));
    expect(ekwoModules.size).toBeGreaterThan(0);
    expect(nexgenModules).toContain('billing');
    expect([...nexgenModules].filter((s) => ekwoModules.has(s) || EKWO_SCHEMAS.includes(s))).toEqual([]);
    // The schema name `ekwo` is reserved for Ekwo OS.
    expect(nexgenModules.has('ekwo')).toBe(false);
    expect(run().all.has('schema ekwo')).toBe(false);
  });

  it('short names both sides use live apart, each in its own schema', () => {
    const [{ ekwo: e, nexgen: n }] = sides();
    const named = (set: Set<string>) =>
      new Set([...set].filter((o) => !o.startsWith('schema ') && !/_(pkey|key)$/.test(o)).map(nameOf));
    const ekwoNames = named(e);
    // Each core reaches its own through its search path: `nexgen, public` for
    // Nexgen OS, `public` for Ekwo OS; `billing.contacts` and
    // `public.contacts` are read by their schema. The keys keep Ekwo OS's
    // names (decision 0046), and so do the capabilities (decision 0051), in
    // `nexgen`; a surface calls them qualified.
    expect([...named(n)].filter((x) => ekwoNames.has(x)).sort()).toEqual([
      'function accept_invitation(p_token',
      'function revoke_api_key(p_api_key_id',
      'function revoke_invitation(p_invitation_id',
      'function set_updated_at()',
      'function use_api_key(p_secret',
      'relation api_keys',
      'relation capabilities',
      'relation contacts',
      'relation currencies',
      'relation documents',
      'relation modules',
      'relation products',
      'relation role_capabilities',
      'relation schema_migrations',
      'type member_role',
    ]);
  });
});
