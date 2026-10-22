// An energy bill, read once, enriches the model: the bill a document of its
// participant, its meter found or declared, its contract as attributes, its
// energy a estimated curve, its invoice a purchase of the billing bridge.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, one, organisation } from './helpers/db.js';
import { importEnergyBill, meterOfBill } from '@nexgen-os/core';
import { readEnergyBill } from '@nexgen-os/energy-bill';
import { estimateFromBill } from '../modules/consumption/src/bill.js';
import { OTHER_CURRENCY, TWO_PERIODS } from '../packages/formats/energy-bill/tests/fixtures/bills.js';

let db: PGlite;
let farm: string;

const reading = readEnergyBill({ ...TWO_PERIODS, energy: { ...TWO_PERIODS.energy, meter: { ...TWO_PERIODS.energy.meter!, operator: 'enedis' } } });
const file = (n: string) => ({ name: 'bill.pdf', uri: 'storage://bills/bill.pdf', mediaType: 'application/pdf', byteSize: 81234, checksum: `sha256:${n.repeat(64)}` });

beforeAll(async () => {
  db = await freshDatabase(['grid', 'actions', 'consumption', 'billing'], ['fr']);
  const org = await organisation(db, 'Farm company');
  const contact = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Farm owner') returning id`, [org])).id;
  const project = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, country) values ($1, 'Farm', 'FR') returning id`, [org])).id;
  farm = (await one<{ id: string }>(db,
    `insert into participants (organisation_id, project_id, name, country, time_zone, contact_id) values ($1, $2, 'Farm', 'FR', 'Europe/Paris', $3) returning id`,
    [org, project, contact])).id;
});

afterAll(async () => {
  await db.close();
});

describe('a bill written into the model', () => {
  let imported: Awaited<ReturnType<typeof importEnergyBill>>;

  beforeAll(async () => {
    imported = await asUser(db, USER_A, () => importEnergyBill(db, { participantId: farm, reading, file: file('a') }));
  });

  it('attaches the bill to its participant with its checksum, once', async () => {
    const doc = await one<{ checksum: string; source: string; metadata: { invoice: { number: string; currency: string } } }>(db, 'select checksum, source, metadata from documents where id = $1', [imported.documentId]);
    expect(doc.checksum).toBe(`sha256:${'a'.repeat(64)}`);
    expect(doc.source).toBe('invoice A-2026-0817 of 2026-08-17 from Supplier A');
    expect(doc.metadata.invoice).toMatchObject({ number: 'A-2026-0817', currency: 'EUR' });
    await expect(asUser(db, USER_A, () => importEnergyBill(db, { participantId: farm, reading, file: file('a') }))).rejects.toThrow(/^already_imported/);
  });

  it('declares the meter once, finds it after, and connects it to the operator the bill names', async () => {
    expect(imported.meterFound).toBe(false);
    expect(await asUser(db, USER_A, () => meterOfBill(db, farm, reading))).toEqual({ meterId: imported.meterId, found: true });
    expect(await one(db, `select count(*)::int n from meters where scheme = 'prm' and identifier = '00000000000017'`)).toEqual({ n: 1 });
    await asUser(db, USER_A, () => db.query('select grid.connect_to_operator($1, $2)', [imported.meterId, reading.meter!.operator]));
    expect(await one(db, 'select grid_operator from grid.meters where id = $1', [imported.meterId])).toEqual({ grid_operator: 'enedis' });
  });

  it('prices the contract as published attributes whose source is the bill, from the first day of its period', async () => {
    const rows = (await db.query<{ attribute_type: string; object_kind: string; value: unknown; status: string; source: string; valid_from: string }>(
      `select attribute_type, object_kind, value, status, source, valid_from::text from attributes where object_id in ($1, $2) order by attribute_type`,
      [farm, imported.meterId])).rows;
    expect(rows.map((r) => [r.attribute_type, r.object_kind])).toEqual([
      ['grid_fees_and_taxes', 'participant'],
      ['subscribed_apparent_power', 'meter'],
      ['supply_energy_price', 'participant'],
      ['supply_tariff', 'participant'],
    ]);
    expect(rows.every((r) => r.status === 'published' && r.source === `documents:${imported.documentId}`)).toBe(true);
    expect(new Date(rows[0]!.valid_from).toISOString()).toBe('2026-07-15T22:00:00.000Z');
    // Delivery is inside the energy price: the fees are the excise alone, per MWh.
    expect(rows[0]!.value).toBe(30.74);
    expect(rows[1]!.value).toBe(36);
    // (4227 × 0.13781 + 1902 × 0.09938) / 6129 = 0.12588 per kWh, per MWh.
    expect(rows[2]!.value).toBe(125.88);
    expect(rows[3]!.value).toMatchObject({ currency: 'EUR', projection: 'weighted', bands: [{ band: 'peak', billed: 0.13781 }, { band: 'offpeak', billed: 0.09938 }] });
  });

  it('is read back as the participant\'s parameters', async () => {
    const p = await one<{ v: { value: number; status: string; level: string } }>(db, `select parameter_of('participant', $1, 'supply_energy_price', '2026-08-01') v`, [farm]);
    expect(p.v).toMatchObject({ value: 125.88, status: 'published' });
  });

  it('estimates the energy of its period, in kWh, as an estimate that names the bill', async () => {
    const r = await asUser(db, USER_A, () => estimateFromBill(db, { participantId: farm, reading, profileCode: 'flat', documentId: imported.documentId }));
    expect(r.kwh).toBeCloseTo(6129, 3);
    // 16 July to 15 August included: 31 days of 24 hours.
    expect(r.slots).toBe(744);
    const inputs = await one<{ i: { energy: { kwh: number; document_id: string }; period: { from: string; to: string } } }>(db, 'select inputs i from consumption.estimates where id = $1', [r.estimateId]);
    expect(inputs.i.energy).toMatchObject({ kwh: 6129, document_id: imported.documentId });
    expect(inputs.i.period).toMatchObject({ from: '2026-07-16', to: '2026-08-16' });
  });

  it('records the invoice as a purchase of the participant, by its id in Ekwo OS', async () => {
    const ekwo = randomUUID();
    const period = reading.invoice.invoicingPeriod!;
    await asUser(db, USER_A, () => db.query(`select billing.record_invoice($1, $2, 'purchase', $3, $4)`, [farm, ekwo, period.start, period.end]));
    expect(await one(db, 'select kind, period_from::text, period_to::text from billing.invoices where id = $1', [ekwo])).toEqual({ kind: 'purchase', period_from: '2026-08-01', period_to: '2026-08-31' });
  });

  it('refuses a bill in another currency than the country\'s, and writes nothing', async () => {
    const before = await one<{ n: number }>(db, 'select count(*)::int n from documents');
    await expect(asUser(db, USER_A, () => importEnergyBill(db, { participantId: farm, reading: readEnergyBill(OTHER_CURRENCY), file: file('b') }))).rejects.toThrow(/^currency_mismatch: the bill is in CHF/);
    expect(await one(db, 'select count(*)::int n from documents')).toEqual(before);
  });
});
