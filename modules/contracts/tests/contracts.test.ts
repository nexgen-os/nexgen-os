// The `contracts` module on a database: a community where a consumer buys
// from a producer of its project under a physical PPA and from its supplier
// for the rest, a producer that sells what is left at the market, the prices
// each contract sets — fixed, indexed on the day-ahead price with a floor and
// a cap — and what each refuses by name, under row level security.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { store } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let other: string;
let project: string;
let consumer: string;
let producer: string;
let meter: string;
let supplier: string;
let dayAhead: string;

const FROM = '2026-06-01T00:00:00.000Z';
const at = (h: number) => new Date(Date.parse(FROM) + h * 3_600_000).toISOString();

async function place(name: string, fields: Record<string, unknown> = {}): Promise<string> {
  return insert(db, 'participants', { organisation_id: org, project_id: project, name, country: 'BE', time_zone: 'Europe/Brussels', segment: 'individual', ...fields });
}

async function contract(fields: Record<string, unknown>): Promise<string> {
  return insert(db, 'contracts.contracts', { organisation_id: org, valid_from: '2026-01-01', ...fields });
}

async function price(contractId: string, component: string, at: string): Promise<Record<string, unknown> | null> {
  return (await one<{ p: Record<string, unknown> | null }>(db, 'select contracts.price_at($1, $2, $3) p', [contractId, component, at])).p;
}

beforeAll(async () => {
  db = await freshDatabase(['grid', 'contracts'], ['be']);
  org = await organisation(db, 'A community operator', USER_A);
  other = await organisation(db, 'Another company', USER_B);
  project = await insert(db, 'projects', { organisation_id: org, name: 'A community', kind: 'energy_community', country: 'BE' });
  consumer = await place('Bakery');
  producer = await place('School roof');
  meter = await insert(db, 'meters', { organisation_id: org, participant_id: consumer, identifier: '871000000000000001', scheme: 'gs1_gsrn' });
  supplier = await insert(db, 'contacts', { organisation_id: org, name: 'A supplier', kind: 'company' });
  // The day-ahead price of the bidding zone, a series of the organisation, in EUR per MWh.
  dayAhead = (
    await store(
      db,
      { object_kind: 'organisation', object_id: org, quantity_code: 'energy_price', kind: 'measured', value_kind: 'interval', step: '1 hour', name: 'Day-ahead' },
      [0, 1, 2].map((h) => ({ at: at(h), value: [80, -20, 400][h] })),
      { unit: 'EUR-PER-MegaW-HR' },
    )
  ).seriesId;
});

afterAll(async () => {
  await db?.close();
});

describe('a contract', () => {
  it('ships its kinds and volume modes as vocabularies', async () => {
    const kinds = (await db.query<{ code: string }>('select code from contracts.kinds order by code')).rows.map((r) => r.code);
    expect(kinds).toEqual(['community_tariff', 'injection', 'market', 'ppa_physical', 'ppa_virtual', 'supply']);
    const modes = (await db.query<{ code: string }>('select code from contracts.volume_modes order by code')).rows.map((r) => r.code);
    expect(modes).toEqual(['allocated_power', 'pay_as_consumed', 'pay_as_produced']);
  });

  it('takes the organisation of its participant and the currency of its country', async () => {
    const id = await contract({ organisation_id: other, participant_id: consumer, kind: 'supply', flow: 'offtake', counterparty_contact_id: supplier, meter_id: meter, priority: 10, reference: 'SUP-1' });
    expect(await one(db, 'select organisation_id, currency from contracts.contracts where id = $1', [id])).toEqual({ organisation_id: org, currency: 'EUR' });
  });

  it('lists the contracts of a flow in the order of the cascade', async () => {
    const ppa = await contract({ participant_id: consumer, kind: 'ppa_physical', flow: 'offtake', counterparty_participant_id: producer, volume_mode: 'pay_as_produced', priority: 1 });
    await contract({ participant_id: consumer, kind: 'supply', flow: 'offtake', valid_from: '2025-01-01', valid_to: '2026-01-01', priority: 0 });
    const rows = (await db.query<{ id: string; kind: string }>(`select id, kind from contracts.in_force($1, 'offtake', '2026-06-01')`, [consumer])).rows;
    expect(rows.map((r) => r.kind)).toEqual(['ppa_physical', 'supply']);
    expect(rows[0].id).toBe(ppa);
    expect((await db.query(`select 1 from contracts.in_force($1, 'injection', '2026-06-01')`, [consumer])).rows).toHaveLength(0);
  });

  it('refuses what does not hold, by name', async () => {
    await expect(contract({ participant_id: consumer, kind: 'supply', flow: 'injection' })).rejects.toThrow(/flow_not_of_kind/);
    await expect(contract({ participant_id: producer, kind: 'injection', flow: 'injection', meter_id: meter })).rejects.toThrow(/meter_of_other_participant/);
    await expect(contract({ participant_id: consumer, kind: 'ppa_physical', flow: 'offtake', counterparty_participant_id: consumer })).rejects.toThrow(/counterparty_is_participant/);
    const elsewhere = await insert(db, 'projects', { organisation_id: org, name: 'Another project', country: 'BE' });
    const far = await insert(db, 'participants', { organisation_id: org, project_id: elsewhere, name: 'Far away', country: 'BE', time_zone: 'Europe/Brussels', segment: 'individual' });
    await expect(contract({ participant_id: consumer, kind: 'ppa_physical', flow: 'offtake', counterparty_participant_id: far })).rejects.toThrow(/counterparty_of_other_project/);
    const theirs = await insert(db, 'contacts', { organisation_id: other, name: 'Their supplier', kind: 'company' });
    await expect(contract({ participant_id: consumer, kind: 'supply', flow: 'offtake', counterparty_contact_id: theirs })).rejects.toThrow(/contact_of_other_organisation/);
    await expect(contract({ participant_id: consumer, kind: 'supply', flow: 'offtake', counterparty_contact_id: supplier, counterparty_participant_id: producer })).rejects.toThrow(/contracts_one_counterparty/);
    await expect(contract({ participant_id: consumer, kind: 'community_tariff', flow: 'offtake', volume_mode: 'allocated_power' })).rejects.toThrow(/allocated_power_required/);
    await expect(contract({ participant_id: consumer, kind: 'supply', flow: 'offtake', allocated_power_kw: 3 })).rejects.toThrow(/allocated_power_not_counted/);
    // A country no installed pack declares: no currency to default to.
    const nowhere = await place('Abroad', { country: 'JP', time_zone: 'Asia/Tokyo' });
    await expect(contract({ participant_id: nowhere, kind: 'supply', flow: 'offtake' })).rejects.toThrow(/currency_required/);
  });
});

describe('a price signal', () => {
  let ppa: string;
  let market: string;

  beforeAll(async () => {
    ppa = await contract({ participant_id: consumer, kind: 'ppa_physical', flow: 'offtake', counterparty_participant_id: producer, priority: 2 });
    market = await contract({ participant_id: producer, kind: 'market', flow: 'injection', priority: 99 });
  });

  it('sets a fixed price over an ISO 8601 period', async () => {
    await insert(db, 'contracts.price_signals', { organisation_id: org, contract_id: ppa, component: 'energy_price', form: 'fixed', value: 95, valid_from: '2026-01-01T00:00:00Z', duration: 'P1Y' });
    expect(await price(ppa, 'energy_price', at(1))).toMatchObject({ price: 95, unit: 'EUR-PER-MegaW-HR', currency: 'EUR', form: 'fixed', index: null });
    expect(await price(ppa, 'energy_price', '2027-01-01T00:00:00Z')).toBeNull();
    expect(await price(ppa, 'power_price', at(1))).toBeNull();
  });

  it('reads an indexed price on the price series at each instant, within its floor and cap', async () => {
    await insert(db, 'contracts.price_signals', {
      organisation_id: org, contract_id: market, component: 'energy_price', form: 'indexed', factor: 0.9, value: -5, floor: 0, cap: 300, index_series_id: dayAhead, valid_from: '2026-01-01T00:00:00Z',
    });
    expect(await price(market, 'energy_price', at(0))).toMatchObject({ price: 67, index: 80 });
    // 30 minutes into the hour: the value of the hour.
    expect(await price(market, 'energy_price', new Date(Date.parse(at(0)) + 1_800_000).toISOString())).toMatchObject({ price: 67 });
    expect(await price(market, 'energy_price', at(1))).toMatchObject({ price: 0, index: -20 });
    expect(await price(market, 'energy_price', at(2))).toMatchObject({ price: 300, index: 400 });
    await expect(price(market, 'energy_price', at(5))).rejects.toThrow(/index_value_missing/);
  });

  it('refuses what does not hold, by name', async () => {
    const signal = (fields: Record<string, unknown>) =>
      insert(db, 'contracts.price_signals', { organisation_id: org, contract_id: ppa, component: 'energy_price', form: 'fixed', value: 90, valid_from: '2026-07-01T00:00:00Z', ...fields });
    await expect(signal({})).rejects.toThrow(/overlapping_value/);
    await expect(signal({ component: 'offtake_energy' })).rejects.toThrow(/component_not_priced/);
    await expect(signal({ form: 'indexed', value: null, valid_from: '2028-01-01T00:00:00Z' })).rejects.toThrow(/price_signals_indexed/);
    const power = await store(
      db,
      { object_kind: 'organisation', object_id: org, quantity_code: 'power_price', kind: 'measured', value_kind: 'interval', step: '1 hour', name: 'Capacity' },
      [{ at: at(0), value: 40 }],
      { unit: 'EUR-PER-KiloW-YR' },
    );
    await expect(signal({ form: 'indexed', value: null, index_series_id: power.seriesId })).rejects.toThrow(/index_of_other_quantity/);
    const theirs = (
      await store(
        db,
        { object_kind: 'organisation', object_id: other, quantity_code: 'energy_price', kind: 'measured', value_kind: 'interval', step: '1 hour', name: 'Their day-ahead' },
        [{ at: at(0), value: 1 }],
        { unit: 'EUR-PER-MegaW-HR' },
      )
    ).seriesId;
    await expect(signal({ form: 'indexed', value: null, index_series_id: theirs, valid_from: '2027-01-01T00:00:00Z' })).rejects.toThrow(/series_of_other_organisation/);
    await expect(db.query(`update contracts.contracts set currency = 'USD' where id = $1`, [ppa])).rejects.toThrow(/currency_edited/);
  });
});

describe('row level security', () => {
  it('shows the contracts and prices of an organisation to its members only', async () => {
    const mine = await asUser(db, USER_A, async () => (await db.query('select id from contracts.contracts')).rows.length);
    expect(mine).toBeGreaterThan(0);
    expect(await asUser(db, USER_B, async () => (await db.query('select id from contracts.contracts')).rows)).toHaveLength(0);
    expect(await asUser(db, USER_B, async () => (await db.query('select id from contracts.price_signals')).rows)).toHaveLength(0);
    // Somebody else's participant does not exist for them.
    await expect(
      asUser(db, USER_B, () => db.query(`insert into contracts.contracts (organisation_id, participant_id, kind, flow, valid_from, currency) values ($1, $2, 'supply', 'offtake', '2026-01-01', 'EUR')`, [other, consumer])),
    ).rejects.toThrow(/participant_not_found/);
  });

  it('reads a price as a member, through the same function', async () => {
    const id = (await one<{ id: string }>(db, `select id from contracts.contracts where kind = 'market'`)).id;
    expect(await asUser(db, USER_A, () => price(id, 'energy_price', at(0)))).toMatchObject({ price: 67 });
    await expect(asUser(db, USER_B, () => price(id, 'energy_price', at(0)))).rejects.toThrow(/contract_not_found/);
  });
});
