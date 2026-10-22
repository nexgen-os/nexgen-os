// The charging tools through the server, acting as the person: the
// sessions of a charger read back, a charging profile proposed by the agent
// as a command it never validates itself, and charge points sized by the
// criterion the person chose.
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
let site: string;
let charger: string;

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  expect(r.isError, r.content[0]!.text).toBeFalsy();
  return JSON.parse(r.content[0]!.text);
};

beforeAll(async () => {
  db = await freshDatabase(['actions', 'charging']);
  const org = await organisation(db, 'A fleet operator', USER_A);
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Depot', kind: 'individual_self_consumption', country: 'BE' });
  site = (await one<{ id: string }>(db, `select join_project($1, 'Depot', '{"country": "BE"}') id`, [project])).id;
  charger = (await one<{ id: string }>(db, `select install_device($1, 'charger', 'Wallbox', p_rated_power_kw => 11) id`, [site])).id;
  await insert(db, 'charging.devices', { id: charger, charge_point_id: 'CP-1', ocpp_version: '2.0.1' });
  await db.query(`select charging.record($1, '{"transaction_id": "t-1", "started_at": "2026-06-01T08:00:00Z", "ended_at": "2026-06-01T10:00:00Z", "energy_kwh": 18, "id_token": "TAG-1"}'::jsonb)`, [charger]);

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

describe('the charging tools', () => {
  it('read the sessions of a participant, without the id token', async () => {
    const sessions = await call('charging_sessions', { participant_id: site });
    expect(sessions).toMatchObject([{ device_id: charger, transaction_id: 't-1', energy_kwh: 18, source: 'station' }]);
    expect(sessions[0]).not.toHaveProperty('id_token');
  });

  it('propose a charging profile as a command of the agent, left for the person to validate', async () => {
    const { id } = await call('charging_limit', { device_id: charger, schedule: { rate_unit: 'W', starts_at: '2026-06-02T17:00:00Z', periods: [{ start_s: 0, limit: 7400 }] } });
    expect(await one(db, 'select kind, status, source, value from actions.actions where id = $1', [id])).toEqual({ kind: 'command', status: 'proposed', source: 'agent', value: 7.4 });
  });

  it('size charge points by the criterion the person chose', async () => {
    const sized = await call('charging_size', {
      subject: { kind: 'participant', id: site }, criterion: 'max_power',
      vehicles: [{ arrival: '18:00', departure: '06:00', energyKwh: 40, count: 4 }], bounds: { powersKw: [7.4, 11], connectionKw: 30 },
    });
    expect(sized.recommended).toMatchObject({ installed_kw: 29.6, points: 4, power_kw: 7.4 });
  });
});
