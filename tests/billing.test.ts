// The `billing` module without Ekwo OS: the participant of the core is the
// one who is billed, and the module keeps a pointer to each Ekwo invoice
// issued for or to it (decision 0043). Without Ekwo's tables in the
// database, the Ekwo ids are plain uuids: no foreign key reaches `public`,
// `record_invoice()` accepts any id, and the doctor finds nothing to report.
// With Ekwo OS on the same database, the keys are real:
// `tests/cross-install.test.ts`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { doctor } from '../packages/cli/src/index.js';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, repoRoot, sqlClient } from './helpers/db.js';

let db: PGlite;
let org: string;
let other: string;
let seller: string;
let buyer: string;
let unnamed: string;
let stranger: string;
let run: string;

const uuid = async () => (await one<{ id: string }>(db, 'select gen_random_uuid() id')).id;

async function participant(organisationId: string, project: string, name: string, contactId: string | null) {
  return (
    await one<{ id: string }>(
      db,
      `insert into participants (organisation_id, project_id, name, contact_id, status) values ($1, $2, $3, $4, 'active') returning id`,
      [organisationId, project, name, contactId],
    )
  ).id;
}

async function project(organisationId: string) {
  return (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'Shared roof', 'energy_community', 'NL') returning id`, [organisationId])).id;
}

async function contact(organisationId: string, name: string) {
  return (await one<{ id: string }>(db, 'insert into contacts (organisation_id, name) values ($1, $2) returning id', [organisationId, name])).id;
}

const record = (args: unknown[]) =>
  db.query('select billing.record_invoice($1, $2, $3, $4, $5, $6, $7) id', args);

beforeAll(async () => {
  db = await freshDatabase(['billing']);
  org = await organisation(db, 'Harbour cooperative', USER_A);
  other = await organisation(db, 'Another cooperative', USER_B);
  const p = await project(org);
  seller = await participant(org, p, 'Roof plant', await contact(org, 'Plant owner'));
  buyer = await participant(org, p, 'Warehouse', await contact(org, 'Warehouse tenant'));
  unnamed = await participant(org, p, 'Workshop', null);
  stranger = await participant(other, await project(other), 'Elsewhere', await contact(other, 'Someone else'));
  run = (await one<{ id: string }>(db, `select record_run('billing', 'test-1', $1, null, '{"period": "2026-05"}', '{}') id`, [p])).id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('billing without Ekwo OS', () => {
  it('registers the module and adds no foreign key to Ekwo', async () => {
    expect((await one<{ v: string }>(db, `select version v from modules where code = 'billing'`)).v).toBe('0.2.0');
    const keys = await db.query<{ conname: string }>(
      `select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace
         join pg_class f on f.oid = c.confrelid join pg_namespace fn on fn.oid = f.relnamespace
        where n.nspname = 'billing' and c.contype = 'f' and fn.nspname <> 'nexgen'`,
    );
    expect(keys.rows).toEqual([]);
    expect((await one<{ k: string[] }>(db, 'select billing.reference_ekwo() k')).k).toEqual([]);
  });

  it('records a bill between two participants with any Ekwo id, and lists it', async () => {
    const id = await uuid();
    await asUser(db, USER_A, () => record([buyer, id, 'purchase', '2026-05-01', '2026-05-31', seller, run]));
    const rows = await asUser(db, USER_A, () =>
      db.query<Record<string, unknown>>(
        `select id, organisation_id, participant_id, counterparty_participant_id, kind, period_from::text, period_to::text, run_id
           from billing.invoices_of($1)`,
        [buyer],
      ),
    );
    expect(rows.rows).toEqual([
      { id, organisation_id: org, participant_id: buyer, counterparty_participant_id: seller, kind: 'purchase', period_from: '2026-05-01', period_to: '2026-05-31', run_id: run },
    ]);
    expect((await asUser(db, USER_B, () => db.query('select * from billing.invoices'))).rows).toEqual([]);
  });

  it('holds no amount, currency, status or line', async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'billing' and table_name = 'invoices' order by ordinal_position`,
    );
    expect(columns.rows.map((c) => c.column_name)).toEqual([
      'id', 'organisation_id', 'participant_id', 'counterparty_participant_id', 'kind', 'period_from', 'period_to', 'run_id', 'created_at',
    ]);
  });

  it('refuses by name', async () => {
    await expect(record([await uuid(), await uuid(), 'sale', '2026-05-01', '2026-05-31', null, null])).rejects.toThrow(/^participant_not_found/);
    await expect(record([unnamed, await uuid(), 'sale', '2026-05-01', '2026-05-31', null, null])).rejects.toThrow(/^participant_contact_missing/);
    await expect(record([seller, await uuid(), 'sale', '2026-05-01', '2026-05-31', stranger, null])).rejects.toThrow(/^parent_in_other_organisation: counterparty_participant_id/);
    await expect(record([seller, await uuid(), 'sale', '2026-05-01', '2026-05-31', seller, null])).rejects.toThrow(/invoices_counterparty_not_self/);
    await expect(record([seller, await uuid(), 'refund', '2026-05-01', '2026-05-31', null, null])).rejects.toThrow(/invoices_kind/);
    await expect(record([seller, await uuid(), 'sale', '2026-05-31', '2026-05-01', null, null])).rejects.toThrow(/invoices_period/);
    const id = await uuid();
    await record([seller, id, 'sale', '2026-05-01', '2026-05-31', buyer, run]);
    await expect(record([seller, id, 'sale', '2026-05-01', '2026-05-31', buyer, run])).rejects.toThrow(/^invoice_already_recorded/);
    // A participant of another organisation is not seen, so not found.
    await expect(asUser(db, USER_A, () => record([stranger, id, 'sale', '2026-05-01', '2026-05-31', null, null]))).rejects.toThrow(/^participant_not_found/);
  });

  it('links an organisation and a contact to Ekwo, one each', async () => {
    const company = await uuid();
    await asUser(db, USER_A, async () => {
      await db.query('select billing.link_company($1, $2)', [org, await uuid()]);
      await db.query('select billing.link_company($1, $2)', [org, company]);
    });
    expect((await db.query('select ekwo_company_id from billing.companies where organisation_id = $1', [org])).rows).toEqual([{ ekwo_company_id: company }]);
    const c = await contact(org, 'Billing desk');
    await db.query(`insert into billing.contacts (id, email) values ($1, 'desk@example.org')`, [c]);
    const ekwoContact = await uuid();
    await db.query('select billing.link_contact($1, $2)', [c, ekwoContact]);
    expect((await one(db, 'select organisation_id, ekwo_contact_id, email from billing.contacts where id = $1', [c]))).toEqual({
      organisation_id: org, ekwo_contact_id: ekwoContact, email: 'desk@example.org',
    });
    await expect(db.query('select billing.link_contact($1, $2)', [await uuid(), ekwoContact])).rejects.toThrow(/^contact_not_found/);
    await expect(db.query('select billing.link_company($1, $2)', [await uuid(), company])).rejects.toThrow(/^organisation_not_found/);
  });

  it('leaves the remote path to the invoicing bridge of the contracts module', async () => {
    await expect(db.query('select billing.verify_remote_invoice($1, $2)', ['ekwo-hosted', await uuid()])).rejects.toThrow(/^ekwo_remote_not_supported/);
  });

  it("the doctor reports no Ekwo key when Ekwo's tables are absent", async () => {
    expect((await db.query('select * from billing.unlinked_keys()')).rows).toEqual([]);
    const codes = (await doctor(sqlClient(db))).problems.map((p) => p.code);
    expect(codes).not.toContain('billing_key_unlinked');
    expect(codes).not.toContain('module_table_detached');
    expect(codes).not.toContain('rls_disabled');
  });
});

describe('the energy community of example 3', () => {
  it('records one bill between two participants, from the settlement run', async () => {
    const community = await freshDatabase(['billing', 'community', 'grid']);
    try {
      await community.exec(await readFile(join(repoRoot, 'examples', '03-energy-community.sql'), 'utf8'));
      const bills = await community.query(
        `select i.id, p.name participant, c.name counterparty, i.kind, i.period_from::text, i.period_to::text, r.module_code
           from billing.invoices_of('00000000-0000-4000-8000-000300000051') i
           join participants p on p.id = i.participant_id
           join participants c on c.id = i.counterparty_participant_id
           join runs r on r.id = i.run_id`,
      );
      expect(bills.rows).toEqual([
        { id: '22222222-2222-4222-8222-222222222201', participant: 'Van Dijk Logistiek', counterparty: 'Roof plant', kind: 'purchase', period_from: '2026-05-01', period_to: '2026-05-31', module_code: 'community' },
      ]);
    } finally {
      await community.close();
    }
  }, 120_000);
});
