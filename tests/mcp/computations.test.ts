// A computation of a module through the server: solar_size calls the code
// of the solar module the host handed in (`modules/computations.ts`), acting
// as the person, and the estimate it kept is read back by solar_estimates.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { personSession } from '@nexgen-os/core';
import { buildServer } from '@nexgen-os/mcp';
import { MODULE_COMPUTATIONS } from '../../modules/computations.js';
import { USER_A, freshDatabase, insert, one, organisation, sqlClient } from '../helpers/db.js';

let db: PGlite;
let client: Client;
let home: string;
let shape: string;
const hours = Array.from({ length: 48 }, (_, h) => new Date(Date.UTC(2026, 5, 1, h)).toISOString());

beforeAll(async () => {
  db = await freshDatabase(['solar', 'actions', 'consumption', 'building']);
  const org = await organisation(db, 'A sizing office', USER_A);
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Roof study', kind: 'pv_roof', country: 'BE' });
  home = (await one<{ id: string }>(db, `select join_project($1, 'House', '{"country": "BE"}') id`, [project])).id;
  const reference = (await one<{ id: string }>(db, `select join_project($1, 'Reference', '{"country": "BE"}', 'producer') id`, [project])).id;
  const pv = (await one<{ id: string }>(db, `select install_device($1, 'solar', 'Reference array', p_rated_power_kw => 1) id`, [reference])).id;
  const store = (object: Record<string, unknown>, values: number[]) =>
    one<{ series_id: string }>(db, `select series_id from store(null, $1::timestamptz[], $2::float8[], p_series => $3::jsonb)`, [hours, values, JSON.stringify(object)]);
  shape = (await store({ object_kind: 'device', object_id: pv, quantity_code: 'production_energy', step: '1 hour' },
    hours.map((_, h) => (h % 24 >= 8 && h % 24 < 16 ? 0.5 : 0)))).series_id;
  await store({ object_kind: 'participant', object_id: home, quantity_code: 'consumption_energy', step: '1 hour' }, hours.map(() => 1));

  const modules = (await db.query<{ code: string }>('select code from modules')).rows.map((m) => m.code);
  const server = buildServer(personSession(sqlClient(db), { kind: 'user', userId: USER_A }, { writable: true }), { modules, computations: MODULE_COMPUTATIONS });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});

afterAll(async () => {
  await db.close();
});

describe('a computation through the server', () => {
  it('sizes with the criterion the person chose, and the estimate is read back', async () => {
    const r = (await client.callTool({ name: 'solar_size', arguments: {
      participantId: home, criterion: 'self_consumption_rate', target: 0.8, from: hours[0], to: '2026-06-03T00:00:00.000Z', step: '1 hour',
      shape: { seriesId: shape, kwp: 1 }, bounds: { maxKwp: 10, source: 'the owner' },
    } })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError, r.content[0]!.text).toBeFalsy();
    const sized = JSON.parse(r.content[0]!.text);
    expect(sized.recommended.kwp).toBeCloseTo(2.5, 6);
    const estimates = (await client.callTool({ name: 'solar_estimates', arguments: { participant_id: home } })) as { content: { text: string }[] };
    expect(JSON.parse(estimates.content[0]!.text)).toMatchObject([{ id: sized.estimateId, kind: 'sizing', provenance: 'solar-size-0.3.0' }]);
  });
});
