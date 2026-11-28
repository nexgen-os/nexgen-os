// An aggregator connector keeps the activations its platform asked of the
// flexible devices it knows (decision 0058): a PV system of 10 kW that can
// give up 6 kW, known at the platform by a site code in its scheme, asked
// three activations — one kept and carried out as a proposed command, one
// beyond what the device declares, one for a device the platform does not
// have here — and asked again without a second activation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  collectActivations, registerSource,
  type ActivationProvider, type DeviceOfSource, type ReceivedActivation,
} from '@nexgen-os/core';
import { USER_A, USER_B, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

const SOURCE = 'example_aggregator';
const SCHEME = 'example_aggregator_site';

let db: PGlite;
let org: string;
let pv: string;
let strangersPv: string;
let connector: string;

const ASKED: ReceivedActivation[] = [
  { identifier: 'SITE-1', direction: 'down', start_at: '2026-06-01T12:00:00Z', end_at: '2026-06-01T12:15:00Z', requested_kw: 5, external_ref: 'ACT-100' },
  { identifier: 'SITE-1', direction: 'down', start_at: '2026-06-01T13:00:00Z', end_at: '2026-06-01T13:15:00Z', requested_kw: 8, external_ref: 'ACT-101' },
  { identifier: 'SITE-9', direction: 'down', start_at: '2026-06-01T12:00:00Z', end_at: '2026-06-01T12:15:00Z', requested_kw: 2, external_ref: 'ACT-102' },
];

/** A platform that answers the activations it was given, whatever devices it is told about. */
const provider = (told: DeviceOfSource[][] = [], asked = ASKED): ActivationProvider => ({
  source_code: SOURCE,
  scheme: SCHEME,
  role: 'aggregator',
  async activations(devices) {
    told.push(devices);
    return asked;
  },
});

beforeAll(async () => {
  db = await freshDatabase(['actions', 'flexibility']);
  org = await organisation(db, 'A solar cooperative', USER_A);
  const other = await organisation(db, 'Another', USER_B);
  // A country is data: Testland and its time zone, as a pack writes them.
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz') on conflict do nothing`);
  const barn = await participant(db, { organisation_id: org, name: 'Barn roof', country: 'ZZ', time_zone: 'UTC' });
  const away = await participant(db, { organisation_id: other, name: 'Elsewhere', country: 'ZZ', time_zone: 'UTC' });
  await registerSource(db, { code: SOURCE, name: 'Example aggregator platform', kind: 'api', auth: 'oauth2', published_by: '@nexgen-os/example-aggregator' });
  await db.query(`insert into identifier_schemes (code, name, source_code) values ($1, 'Example aggregator site', $2)`, [SCHEME, SOURCE]);
  pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Barn PV', null, 10, '2025-01-01') id`, [barn])).id;
  strangersPv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Their PV', null, 10, '2025-01-01') id`, [away])).id;
  await db.query(`insert into flexibility.devices (id, power_down_kw) values ($1, 6), ($2, 6)`, [pv, strangersPv]);
  await db.query(`insert into identifiers (organisation_id, object_kind, object_id, scheme, value) values ($1, 'device', $2, $3, 'SITE-1')`, [org, pv, SCHEME]);
  // The same code at another organisation is not a device of this connector.
  await db.query(`insert into identifiers (organisation_id, object_kind, object_id, scheme, value) values ($1, 'device', $2, $3, 'SITE-9')`, [other, strangersPv, SCHEME]);
  connector = await insert(db, 'connectors', { organisation_id: org, source_code: SOURCE, name: 'Aggregator of the cooperative', secret_ref: 'example_aggregator_token' });
});

afterAll(async () => {
  await db.close();
});

describe('receiving activations', () => {
  it('tells the platform the flexible devices of its organisation, keeps what the device can do as a proposed command, and refuses the rest by name', async () => {
    const told: DeviceOfSource[][] = [];
    const { received } = await collectActivations(db, provider(told), { connectorId: connector, from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' });
    expect(told).toEqual([[{ identifier: 'SITE-1', scheme: SCHEME, device_type: 'solar' }]]);
    expect(received.map((r) => [r.external_ref, r.status, r.refusal])).toEqual([
      ['ACT-100', 'kept', null],
      // 8 kW asked of a device that can give up 6 kW.
      ['ACT-101', 'refused', 'activation_power_invalid'],
      ['ACT-102', 'refused', 'identifier_unknown'],
    ]);

    const kept = await one<Record<string, unknown>>(db,
      `select a.device_id, a.direction, a.requested_kw::float8 requested_kw, a.requested_role, a.external_ref,
              c.kind, c.status, c.source, c.source_ref, c.value::float8 value, c.due_at
         from flexibility.activations a join actions.actions c on c.id = a.command_id
        where a.id = $1`, [received[0]!.activation_id]);
    expect(kept).toEqual({
      device_id: pv, direction: 'down', requested_kw: 5, requested_role: 'aggregator', external_ref: 'ACT-100',
      kind: 'command', status: 'proposed', source: 'detector', source_ref: `flexibility.activations:${received[0]!.activation_id}`,
      value: 5, due_at: new Date('2026-06-01T12:00:00Z'),
    });
    expect((await one<{ n: number }>(db, `select count(*)::int n from flexibility.activations`)).n).toBe(1);
  });

  it('keeps an activation once per device and reference when the platform answers it again', async () => {
    const again = await collectActivations(db, provider(), { connectorId: connector, from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' });
    expect(again.received[0]).toMatchObject({ external_ref: 'ACT-100', status: 'already_received', device_id: pv });
    expect((await one<{ n: number }>(db, `select count(*)::int n from flexibility.activations`)).n).toBe(1);
    const unnamed = await collectActivations(db, provider([], [{ ...ASKED[0]!, external_ref: ' ' }]),
      { connectorId: connector, from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' });
    expect(unnamed.received[0]).toMatchObject({ status: 'refused', refusal: 'external_ref_required' });
  });

  it('refuses by name a connector of another source or one that does not exist', async () => {
    await expect(collectActivations(db, { ...provider(), source_code: 'open_meteo' }, { connectorId: connector, from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' }))
      .rejects.toThrow(/^connector_source_mismatch/);
    await expect(collectActivations(db, provider(), { connectorId: '00000000-0000-4000-8000-0000000000ff', from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' }))
      .rejects.toThrow(/^connector_not_found/);
  });
});

describe('without the flexibility module', () => {
  it('refuses module_not_installed', async () => {
    const bare = await freshDatabase([]);
    try {
      await expect(collectActivations(bare, provider(), { connectorId: connector, from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' }))
        .rejects.toThrow(/^module_not_installed/);
    } finally {
      await bare.close();
    }
  });
});
