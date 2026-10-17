// The `contracts` module: the contracts of the harbour community of example
// 3 — the supply of a warehouse, the community's tariff, a PPA on a roof
// plant — their parties, what they cover, the order they apply in on a day,
// and the prices they set on intervals of time.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const ORG = '00000000-0000-4000-8000-000300000001';
const VAN_DIJK = '00000000-0000-4000-8000-000300000011';
const PROJECT = '00000000-0000-4000-8000-000300000020';
const SITE_12 = '00000000-0000-4000-8000-000300000031';
const METER_12 = '00000000-0000-4000-8000-000300000041';
const METER_14 = '00000000-0000-4000-8000-000300000042';
const PLANT_METER = '00000000-0000-4000-8000-000300000044';
const P_VAN_DIJK = '00000000-0000-4000-8000-000300000051';
const P_MAAS = '00000000-0000-4000-8000-000300000052';
const P_PLANT = '00000000-0000-4000-8000-000300000054';
const SAME_LANDLORD = '00000000-0000-4000-8000-000300000055';

let db: PGlite;
let supplier: string;
let supply: string;
let tariff: string;
let ppa: string;

interface InForce {
  id: string;
  name: string;
  type: string;
  direction: string;
  physical: boolean;
  priority: number | null;
  volume_basis: string;
}

interface Signal {
  id: string;
  price?: number;
  index_code?: string;
  index_multiplier?: number;
  index_adder?: number;
  currency: string;
  per_unit: string;
  source: string;
}

interface Prices {
  contract_id: string;
  at: string;
  signals: Partial<Record<'fixed' | 'indexed' | 'cap' | 'floor', Signal>>;
}

const contract = (fields: Record<string, unknown>) =>
  insert(db, 'contracts.contracts', { organisation_id: ORG, valid_from: '2026-01-01', ...fields });

const signal = (fields: Record<string, unknown>) =>
  insert(db, 'contracts.price_signals', { organisation_id: ORG, per_unit: 'MegaW-HR', source: 'contract', ...fields });

const inForce = async (objectId: string, on: string, scenarioId: string | null = null): Promise<InForce[]> =>
  (await one<{ c: InForce[] }>(db, 'select contracts.in_force($1, $2, $3) c', [objectId, on, scenarioId])).c;

const pricesAt = async (contractId: string, at: string, scenarioId: string | null = null): Promise<Prices> =>
  (await one<{ p: Prices }>(db, 'select contracts.prices_at($1, $2, $3) p', [contractId, at, scenarioId])).p;

beforeAll(async () => {
  db = await freshDatabase(['contracts']);
  await db.exec(await readFile(join(repoRoot, 'examples', '03-energy-community.sql'), 'utf8'));
  await db.query('insert into auth.users (id) values ($1), ($2) on conflict do nothing', [USER_A, USER_B]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'owner')`, [ORG, USER_A]);
  await organisation(db, 'Another cooperative', USER_B);
  supplier = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Havenstroom Levering BV') returning id`, [ORG])).id;
  await db.query(
    `insert into contracts.price_indices (code, name, currency, per_unit, published_by)
     values ('harbour_day_ahead', 'Day-ahead price of the bidding zone', 'EUR', 'MegaW-HR', 'installation')`,
  );

  // Van Dijk buys the rest of what it takes from a supplier.
  supply = await contract({
    type: 'supply', name: 'Supply 2026', reference: 'HS-2026-0412', seller_contact_id: supplier, buyer_contact_id: VAN_DIJK,
    meter_id: METER_12, priority: 3, valid_to: '2027-01-01',
  });
  // The cooperative sells the members what they share, at its tariff.
  tariff = await contract({
    type: 'community_tariff', name: 'Community tariff 2026', buyer_contact_id: VAN_DIJK,
    project_id: PROJECT, participant_id: P_VAN_DIJK, priority: 2,
  });
  // The tenants of the same landlord buy 50 kW of the roof plant.
  ppa = await contract({
    type: 'ppa_physical', name: 'Roof plant PPA', buyer_contact_id: VAN_DIJK, participant_id: SAME_LANDLORD,
    volume_basis: 'allocated_power', allocated_power_kw: 50, priority: 1, valid_from: '2026-03-01',
  });
});

afterAll(async () => {
  await db.close();
});

describe('contracts', () => {
  it('come in types read from a vocabulary, each saying which way energy goes and whether it is delivered', async () => {
    const types = await db.query<{ code: string; direction: string; physical: boolean }>(
      'select code, direction, physical from contracts.contract_types order by code',
    );
    expect(types.rows).toEqual([
      { code: 'community_tariff', direction: 'both', physical: true },
      { code: 'injection', direction: 'injection', physical: true },
      { code: 'market', direction: 'both', physical: true },
      { code: 'ppa_physical', direction: 'offtake', physical: true },
      { code: 'ppa_virtual', direction: 'both', physical: false },
      { code: 'supply', direction: 'offtake', physical: true },
    ]);
    await expect(contract({ type: 'swap', name: 'Unknown', meter_id: METER_12, buyer_contact_id: VAN_DIJK })).rejects.toThrow(/foreign key/);
  });

  it('are objects on the site of what they cover, so that the signed document attaches to them', async () => {
    const c = await one<{ kind: string; site: string; country: string }>(
      db, 'select o.kind, site_of(o.id) site, country_of(o.id) country from objects o where o.id = $1', [supply],
    );
    expect(c).toEqual({ kind: 'contract', site: SITE_12, country: 'NL' });
    await db.query(
      `insert into documents (object_id, name, kind, uri, media_type, source) values ($1, 'Supply contract, signed', 'document', 's3://haven/contracts/hs-2026-0412.pdf', 'application/pdf', 'supplier')`,
      [supply],
    );
    const d = await one<{ organisation_id: string }>(db, 'select organisation_id from documents where object_id = $1', [supply]);
    expect(d.organisation_id).toBe(ORG);
  });

  it('cover something, have two parties, and count their volume one way', async () => {
    await expect(contract({ type: 'supply', name: 'Nothing covered', buyer_contact_id: VAN_DIJK })).rejects.toThrow(/contracts_covers_something/);
    await expect(contract({ type: 'supply', name: 'No party', meter_id: METER_12 })).rejects.toThrow(/contracts_two_parties/);
    await expect(contract({ type: 'supply', name: 'Itself', meter_id: METER_12, seller_contact_id: VAN_DIJK, buyer_contact_id: VAN_DIJK }))
      .rejects.toThrow(/contracts_parties_differ/);
    await expect(contract({ type: 'ppa_physical', name: 'No kW', participant_id: P_MAAS, buyer_contact_id: VAN_DIJK, volume_basis: 'allocated_power' }))
      .rejects.toThrow(/contracts_allocated_power/);
    await expect(contract({ type: 'supply', name: 'kW without allocation', meter_id: METER_12, buyer_contact_id: VAN_DIJK, allocated_power_kw: 10 }))
      .rejects.toThrow(/contracts_allocated_power/);
    await expect(contract({ type: 'supply', name: 'Backwards', meter_id: METER_12, buyer_contact_id: VAN_DIJK, valid_to: '2025-12-31' }))
      .rejects.toThrow(/contracts_period/);
    await expect(contract({ type: 'supply', name: 'Unknown basis', meter_id: METER_12, buyer_contact_id: VAN_DIJK, volume_basis: 'pay_as_hoped' }))
      .rejects.toThrow(/contracts_volume_basis/);
  });

  it('hold together: a meter behind the participant, a participant in the project, parties of the organisation', async () => {
    await expect(contract({ type: 'supply', name: 'Wrong meter', participant_id: P_VAN_DIJK, meter_id: METER_14, buyer_contact_id: VAN_DIJK }))
      .rejects.toThrow(/^meter_not_behind_participant/);
    // A group is behind the meters of the participants it gathers.
    expect(await contract({ type: 'supply', name: 'Group meter', participant_id: SAME_LANDLORD, meter_id: METER_14, buyer_contact_id: VAN_DIJK, status: 'cancelled' }))
      .toMatch(/^[0-9a-f-]{36}$/);
    const other = await one<{ id: string }>(db, `select id from organisations where name = 'Another cooperative'`);
    const theirProject = await insert(db, 'projects', { organisation_id: other.id, name: 'Their community', kind: 'energy_community', country: 'NL' });
    await expect(contract({ type: 'community_tariff', name: 'Their project', project_id: theirProject, buyer_contact_id: VAN_DIJK }))
      .rejects.toThrow(/^parent_in_other_organisation/);
    const theirContact = (await one<{ id: string }>(db, `insert into contacts (organisation_id, name) values ($1, 'Their supplier') returning id`, [other.id])).id;
    await expect(contract({ type: 'supply', name: 'Their supplier', meter_id: METER_12, seller_contact_id: theirContact, buyer_contact_id: VAN_DIJK }))
      .rejects.toThrow(/^contact_in_other_organisation/);
    const ownProject = await insert(db, 'projects', { organisation_id: ORG, name: 'Another project', kind: 'energy_community', country: 'NL' });
    await expect(contract({ type: 'community_tariff', name: 'Mixed', project_id: ownProject, participant_id: P_VAN_DIJK, buyer_contact_id: VAN_DIJK }))
      .rejects.toThrow(/^participant_in_other_project/);
  });

  it('in force on a meter on a day come in the order they apply, from the meter, its participant and its group', async () => {
    const march = await inForce(METER_12, '2026-03-15');
    expect(march.map((c) => [c.name, c.priority, c.type])).toEqual([
      ['Roof plant PPA', 1, 'ppa_physical'],
      ['Community tariff 2026', 2, 'community_tariff'],
      ['Supply 2026', 3, 'supply'],
    ]);
    expect(march[0]).toMatchObject({ direction: 'offtake', physical: true, volume_basis: 'allocated_power' });
    // Before the PPA starts; after the supply ends; the cancelled one never.
    expect((await inForce(METER_12, '2026-02-01')).map((c) => c.name)).toEqual(['Community tariff 2026', 'Supply 2026']);
    expect((await inForce(METER_12, '2027-01-01')).map((c) => c.name)).toEqual(['Roof plant PPA', 'Community tariff 2026']);
    // Through the participant, the same; through the project, every contract of its participants and meters.
    expect((await inForce(P_VAN_DIJK, '2026-03-15')).map((c) => c.name)).toEqual(['Roof plant PPA', 'Community tariff 2026', 'Supply 2026']);
    expect((await inForce(PROJECT, '2026-03-15')).map((c) => c.name)).toEqual(['Roof plant PPA', 'Community tariff 2026', 'Supply 2026']);
    expect(await inForce(PLANT_METER, '2026-03-15')).toEqual([]);
  });
});

describe('price signals', () => {
  it('set a fixed price, a cap and a floor, in the currency and the unit of the row', async () => {
    await signal({ contract_id: supply, kind: 'fixed', starts_at: '2026-01-01T00:00+01', ends_at: '2026-07-01T00:00+02', price: 142.5, currency: 'EUR' });
    await signal({ contract_id: supply, kind: 'fixed', starts_at: '2026-07-01T00:00+02', ends_at: '2027-01-01T00:00+01', price: 138, currency: 'EUR', source: 'amendment 1' });
    await signal({ contract_id: tariff, kind: 'fixed', starts_at: '2026-01-01T00:00+01', price: 0.095, currency: 'EUR', per_unit: 'KiloW-HR', source: 'general assembly' });
    const may = await pricesAt(supply, '2026-05-10T12:00+02');
    expect(may.signals).toEqual({ fixed: expect.objectContaining({ price: 142.5, currency: 'EUR', per_unit: 'MegaW-HR', source: 'contract' }) });
    const august = await pricesAt(supply, '2026-08-10T12:00+02');
    expect(august.signals.fixed).toMatchObject({ price: 138, source: 'amendment 1' });
    expect((await pricesAt(supply, '2027-02-01T00:00+01')).signals).toEqual({});
    expect((await pricesAt(tariff, '2030-01-01T00:00+01')).signals.fixed).toMatchObject({ price: 0.095, per_unit: 'KiloW-HR' });
  });

  it('follow a named index, quoted like it, with a cap and a floor beside', async () => {
    await signal({ contract_id: ppa, kind: 'indexed', starts_at: '2026-03-01T00:00+01', index_code: 'harbour_day_ahead', index_multiplier: 0.9, index_adder: -2.5, currency: 'EUR' });
    await signal({ contract_id: ppa, kind: 'cap', starts_at: '2026-03-01T00:00+01', price: 120, currency: 'EUR' });
    await signal({ contract_id: ppa, kind: 'floor', starts_at: '2026-03-01T00:00+01', price: 35, currency: 'EUR' });
    const p = await pricesAt(ppa, '2026-06-21T13:00+02');
    expect(Object.keys(p.signals).sort()).toEqual(['cap', 'floor', 'indexed']);
    expect(p.signals.indexed).toMatchObject({ index_code: 'harbour_day_ahead', index_multiplier: 0.9, index_adder: -2.5 });
    expect(p.signals.indexed).not.toHaveProperty('price');
    await expect(signal({ contract_id: ppa, kind: 'indexed', starts_at: '2030-01-01T00:00+01', index_code: 'harbour_day_ahead', index_multiplier: 1, currency: 'USD' }))
      .rejects.toThrow(/^index_quoted_otherwise/);
    await expect(signal({ contract_id: ppa, kind: 'indexed', starts_at: '2030-01-01T00:00+01', index_code: 'harbour_day_ahead', index_multiplier: 1, currency: 'EUR', per_unit: 'KiloW-HR' }))
      .rejects.toThrow(/^index_quoted_otherwise/);
  });

  it('have the shape of their kind', async () => {
    const blank = await contract({ type: 'market', name: 'Shapes', meter_id: PLANT_METER, buyer_contact_id: supplier, status: 'draft' });
    const at = { contract_id: blank, starts_at: '2031-01-01T00:00+01', currency: 'EUR' };
    await expect(signal({ ...at, kind: 'fixed' })).rejects.toThrow(/price_signals_shape/);
    await expect(signal({ ...at, kind: 'indexed', price: 50 })).rejects.toThrow(/price_signals_shape/);
    await expect(signal({ ...at, kind: 'indexed', index_code: 'harbour_day_ahead' })).rejects.toThrow(/price_signals_shape/);
    await expect(signal({ ...at, kind: 'cap', price: 100, index_adder: 3 })).rejects.toThrow(/price_signals_shape/);
    await expect(signal({ ...at, kind: 'bonus', price: 1 })).rejects.toThrow(/price_signals_kind/);
    await expect(signal({ ...at, kind: 'fixed', price: 1, currency: 'eur' })).rejects.toThrow(/price_signals_currency_format/);
    await expect(signal({ ...at, kind: 'fixed', price: 1, per_unit: 'GigaW-HR' })).rejects.toThrow(/price_signals_per_unit/);
    await expect(signal({ ...at, kind: 'fixed', price: 1, ends_at: '2030-12-31T00:00+01' })).rejects.toThrow(/price_signals_interval/);
    await expect(signal({ ...at, kind: 'fixed', price: 1, source: ' ' })).rejects.toThrow(/price_signals_source_not_blank/);
  });

  it('of one kind never cover the same instant of a contract; an hourly grid is one row per hour', async () => {
    await expect(signal({ contract_id: supply, kind: 'fixed', starts_at: '2026-06-30T00:00+02', ends_at: '2026-07-02T00:00+02', price: 1, currency: 'EUR' }))
      .rejects.toThrow(/^price_signal_overlap/);
    await expect(signal({ contract_id: ppa, kind: 'cap', starts_at: '2027-01-01T00:00+01', price: 1, currency: 'EUR' }))
      .rejects.toThrow(/^price_signal_overlap/);
    const injection = await contract({ type: 'injection', name: 'Plant injection', seller_contact_id: null, buyer_contact_id: supplier, meter_id: PLANT_METER, volume_basis: 'pay_as_produced' });
    await db.query(
      `insert into contracts.price_signals (organisation_id, contract_id, kind, starts_at, ends_at, price, currency, per_unit, source)
       select $1, $2, 'fixed', h, h + interval '1 hour', 40 + extract(hour from h at time zone 'UTC'), 'EUR', 'MegaW-HR', 'buyer''s hourly grid'
         from generate_series('2026-06-21T00:00Z'::timestamptz, '2026-06-21T23:00Z', interval '1 hour') h`,
      [ORG, injection],
    );
    expect((await pricesAt(injection, '2026-06-21T13:30Z')).signals.fixed).toMatchObject({ price: 53 });
    expect((await pricesAt(injection, '2026-06-21T14:00Z')).signals.fixed).toMatchObject({ price: 54 });
    expect(await inForce(P_PLANT, '2026-06-21')).toEqual([expect.objectContaining({ name: 'Plant injection', direction: 'injection', volume_basis: 'pay_as_produced' })]);
  });

  it('are of their contract organisation, and a scenario has its own before the world as it is', async () => {
    const other = await one<{ id: string }>(db, `select id from organisations where name = 'Another cooperative'`);
    await expect(insert(db, 'contracts.price_signals', { organisation_id: other.id, contract_id: supply, kind: 'fixed', starts_at: '2030-01-01T00:00Z', price: 1, currency: 'EUR', per_unit: 'MegaW-HR', source: 'x' }))
      .rejects.toThrow(/^contract_in_other_organisation/);
    const cheaper = await insert(db, 'scenarios', { organisation_id: ORG, name: 'A cheaper tariff' });
    const evenCheaper = await insert(db, 'scenarios', { organisation_id: ORG, name: 'Even cheaper', parent_id: cheaper });
    await signal({ contract_id: tariff, kind: 'fixed', starts_at: '2026-01-01T00:00+01', price: 0.08, currency: 'EUR', per_unit: 'KiloW-HR', source: 'proposal', scenario_id: cheaper });
    await signal({ contract_id: tariff, kind: 'fixed', starts_at: '2026-01-01T00:00+01', price: 0.07, currency: 'EUR', per_unit: 'KiloW-HR', source: 'proposal 2', scenario_id: evenCheaper });
    expect((await pricesAt(tariff, '2026-05-01T00:00+02')).signals.fixed).toMatchObject({ price: 0.095 });
    expect((await pricesAt(tariff, '2026-05-01T00:00+02', cheaper)).signals.fixed).toMatchObject({ price: 0.08 });
    expect((await pricesAt(tariff, '2026-05-01T00:00+02', evenCheaper)).signals.fixed).toMatchObject({ price: 0.07 });
    // A contract that exists only in a scenario takes signals of that scenario only.
    const proposed = await contract({ type: 'supply', name: 'Proposed supply', meter_id: METER_14, buyer_contact_id: VAN_DIJK, scenario_id: cheaper });
    await expect(signal({ contract_id: proposed, kind: 'fixed', starts_at: '2026-01-01T00:00+01', price: 1, currency: 'EUR' }))
      .rejects.toThrow(/^contract_in_other_scenario/);
    expect((await inForce(METER_14, '2026-05-01')).map((c) => c.name)).toEqual(['Roof plant PPA']);
    expect((await inForce(METER_14, '2026-05-01', cheaper)).map((c) => c.name)).toEqual(['Roof plant PPA', 'Proposed supply']);
  });
});

describe('row level security', () => {
  it('shows each organisation its contracts and their prices only, and lets nobody write in another', async () => {
    const mine = await asUser(db, USER_A, () => inForce(METER_12, '2026-03-15'));
    expect(mine).toHaveLength(3);
    expect(await asUser(db, USER_B, () => inForce(METER_12, '2026-03-15'))).toEqual([]);
    expect((await asUser(db, USER_B, () => pricesAt(supply, '2026-05-10T12:00+02'))).signals).toEqual({});
    const vocabulary = await asUser(db, USER_B, () => db.query('select code from contracts.contract_types'));
    expect(vocabulary.rows).toHaveLength(6);
    await expect(asUser(db, USER_B, () => db.query(
      `insert into contracts.price_signals (organisation_id, contract_id, kind, starts_at, price, currency, per_unit, source)
       values ($1, $2, 'fixed', '2040-01-01', 1, 'EUR', 'MegaW-HR', 'intruder')`, [ORG, supply],
    ))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, USER_B, () => db.query(`insert into contracts.contract_types (code, name, direction, physical) values ('mine', 'Mine', 'both', true)`)))
      .rejects.toThrow(/permission denied|row-level security/);
  });
});
