// The MCP server against the real schema in PGlite: the tools of the core
// and of the modules installed, called through the protocol as a client
// calls them, acting as a person under row level security; refusals by name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { geocoderChain, geocoderNames, personSession, type Acting, type Geocoder } from '@nexgen-os/core';
import { buildServer, readConfig, serverFromEnvironment, SERVER_VERSION, SCHEMA_MIN } from '@nexgen-os/mcp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation, repoRoot, sqlClient } from '../helpers/db.js';

let db: PGlite;
let org: string;

type Result = { isError?: boolean; content: { type: string; text: string }[] };

/** A client connected to a server acting as `acting`, with the modules of the database. */
async function clientAs(acting: Acting, writable = true, geocoder?: Geocoder): Promise<Client> {
  const session = personSession(sqlClient(db), acting, { writable });
  const modules = (await db.query<{ code: string }>('select code from nexgen.modules order by code')).rows.map((m) => m.code);
  const server = buildServer(session, { modules, ...(geocoder ? { geocoder } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ error: boolean; text: string; value: any }> {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const text = r.content[0]?.text ?? '';
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = undefined; }
  return { error: r.isError === true, text, value };
}

let writer: Client;

beforeAll(async () => {
  db = await freshDatabase(['actions', 'kpis', 'solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [USER_B]);
  await db.query(`insert into nexgen.sources (code, name, kind) values ('zz_meter_export', 'Testland meter export', 'file')`);
  writer = await clientAs({ kind: 'user', userId: USER_A });
});

afterAll(async () => {
  await db.close();
});

describe('the server', () => {
  it('says the version of its package and the floor of its schema', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages/mcp/package.json'), 'utf8'));
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(SCHEMA_MIN).toBe(pkg.nexgenOs.schemaMin);
  });

  it('offers the tools of the core and of the modules installed, none of the others', async () => {
    const { tools } = await writer.listTools();
    const names = tools.map((t) => t.name);
    for (const name of ['status', 'list_organisations', 'list_projects', 'list_participants', 'list_meters', 'list_devices', 'list_series',
      'get_object', 'read_series', 'parameter_of', 'create_project', 'add_participant', 'declare_meter', 'install_device', 'store_series',
      'import_series', 'list_modules', 'kpis_of', 'kpis_compute', 'solar_size', 'solar_estimate_yield', 'solar_estimates',
      'actions_of_project', 'actions_propose', 'actions_validate']) {
      expect(names).toContain(name);
    }
    expect(names).not.toContain('storage_size');
    expect(names).not.toContain('community_settle');
    expect(tools.find((t) => t.name === 'read_series')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'actions_validate')?.annotations?.destructiveHint).toBe(true);
  });

  it('describes a place as the person: a project, a participant, a meter, a device, values, read back', async () => {
    const status = await call(writer, 'status');
    expect(status.value.acting_as).toBe(USER_A);
    expect(status.value.organisations).toEqual([{ id: org, name: 'A cooperative', role: 'owner' }]);

    const project = await call(writer, 'create_project', { organisation_id: org, name: 'Rooftops', country: 'be' });
    expect(project.error).toBe(false);
    const participant = await call(writer, 'add_participant', {
      project_id: project.value.id, name: 'School', time_zone: 'Europe/Brussels',
      place: { country: 'BE', city: 'Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85, 0] }, location_precision: 'street', location_source_code: 'nominatim' },
    });
    expect(participant.error, participant.text).toBe(false);
    const pid = participant.value.id;
    const meter = await call(writer, 'declare_meter', { participant_id: pid, identifier: '541448000000000001', scheme: 'gs1_gsrn' });
    expect(meter.error, meter.text).toBe(false);
    const device = await call(writer, 'install_device', { participant_id: pid, device_type: 'solar', name: 'Roof array', rated_power_kw: 9 });
    expect(device.error, device.text).toBe(false);

    const stored = await call(writer, 'store_series', {
      organisation_id: org, object_kind: 'meter', object_id: meter.value.id, quantity_code: 'offtake_energy', source_code: 'zz_meter_export',
      step: '1 hour', unit: 'kWh', values: [{ at: '2026-01-01T00:00:00Z', value: 1.5 }, { at: '2026-01-01T01:00:00Z', value: 2 }],
    });
    expect(stored.error, stored.text).toBe(false);
    const read = await call(writer, 'read_series', { series_id: stored.value.seriesId, from: '2026-01-01T00:00:00Z', to: '2026-01-01T02:00:00Z', step: '1 hour' });
    expect(read.value.map((b: { value: number }) => b.value)).toEqual([1.5, 2]);

    expect((await call(writer, 'list_participants', { project_id: project.value.id })).value).toMatchObject([{ name: 'School', time_zone: 'Europe/Brussels' }]);
    expect((await call(writer, 'list_devices', { participant_id: pid })).value).toMatchObject([{ name: 'Roof array', device_type: 'solar' }]);
    const got = await call(writer, 'get_object', { kind: 'participant', id: pid });
    expect(got.value).toMatchObject({ kind: 'participant', name: 'School' });
  });

  it('finds an address through the geocoder the person configured, and refuses one without', async () => {
    const [project] = (await call(writer, 'list_projects', { organisation_id: org })).value;
    const without = await call(writer, 'add_participant', { project_id: project.id, name: 'Library', address: '1 Main Street' });
    expect(without.error).toBe(true);
    expect(without.text).toMatch(/^geocoder_not_configured:/);

    const geocoder: Geocoder = {
      source_code: 'nominatim',
      search: async () => [{ address: { country: 'BE', city: 'Town' }, lon: 4.4, lat: 50.8, precision: 'rooftop', source_code: 'nominatim', label: '1 Main Street' }],
      reverse: async () => null,
    };
    const placed = await call(await clientAs({ kind: 'user', userId: USER_A }, true, geocoder), 'add_participant',
      { project_id: project.id, name: 'Library', address: '1 Main Street', country: 'BE' });
    expect(placed.error, placed.text).toBe(false);
    expect(placed.value.place).toMatchObject({ country: 'BE', location_precision: 'rooftop', location_source_code: 'nominatim' });
  });

  it('proposes an action as an agent and moves it on the person\'s word', async () => {
    const [project] = (await call(writer, 'list_projects', { organisation_id: org })).value;
    const [school] = (await call(writer, 'list_participants', { project_id: project.id })).value;
    const proposed = await call(writer, 'actions_propose', { object_kind: 'participant', object_id: school.id, phase: 'study', name: 'Heat pump study' });
    expect(proposed.error, proposed.text).toBe(false);
    const moved = await call(writer, 'actions_validate', { action_id: proposed.value.id, status: 'validated' });
    expect(moved.error, moved.text).toBe(false);
    const actions = (await call(writer, 'actions_of_project', { project_id: project.id })).value;
    expect(actions).toMatchObject([{ name: 'Heat pump study', source: 'agent', status: 'validated' }]);
    expect((await call(writer, 'kpis_of', { object_kind: 'participant', object_id: school.id, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })).error).toBe(false);
    expect((await call(writer, 'list_modules')).value).toContainEqual(expect.objectContaining({ code: 'solar', tools: expect.arrayContaining(['solar_size']) }));
  });
});

describe('keys and geocoders', () => {
  it('issues, lists and withdraws a key as an owner; the list never shows a secret', async () => {
    const issued = await call(writer, 'create_api_key', { organisation_id: org, name: 'Nightly import', capabilities: ['data.read', 'data.write'] });
    expect(issued.error, issued.text).toBe(false);
    expect(issued.value.secret).toMatch(/^ngk_/);
    const listed = await call(writer, 'list_api_keys', { organisation_id: org });
    expect(listed.text).not.toContain(issued.value.secret);
    expect(listed.value).toContainEqual(expect.objectContaining({ id: issued.value.api_key_id, capabilities: ['data.read', 'data.write'] }));
    expect((await call(writer, 'revoke_api_key', { api_key_id: issued.value.api_key_id })).error).toBe(false);
    expect((await call(await clientAs({ kind: 'key', secret: issued.value.secret }), 'status')).text).toMatch(/^api_key_revoked:/);
  });

  it('keys the chain by the places the sources serve, the worldwide one last', async () => {
    await db.query(`insert into nexgen.sources (code, name, kind, regions) values ('zz_register', 'Testland register', 'api', array['ZZ-NOR'])`);
    const asked: string[] = [];
    const named = (code: string): Geocoder => ({
      source_code: code,
      search: async () => { asked.push(code); return code === 'nominatim' ? [{ address: { country: 'ZZ' }, lon: 1, lat: 2, precision: 'city', source_code: code, label: 'x' }] : []; },
      reverse: async () => null,
    });
    const chain = await asUser(db, USER_A, () => geocoderChain({ query: async (sql, params) => db.query(sql, params) as never }, { nominatim: named('nominatim'), zz_register: named('zz_register') }));
    const [place] = await chain!.search('1 Main Street', { country: 'ZZ' });
    expect(asked).toEqual(['zz_register', 'nominatim']);
    expect(place?.source_code).toBe('nominatim');
    expect(geocoderNames({ NEXGEN_GEOCODERS: 'ban, photon' })).toEqual(['ban', 'photon']);
    expect(() => geocoderNames({ NEXGEN_GEOCODERS: '../x' })).toThrow(/^bad_geocoder:/);
  });
});

describe('refusals, by name', () => {
  it('reads only, unless the person allows writing', async () => {
    const reader = await clientAs({ kind: 'user', userId: USER_A }, false);
    expect((await call(reader, 'list_organisations')).value).toHaveLength(1);
    const refused = await call(reader, 'create_project', { organisation_id: org, name: 'Not now', country: 'BE' });
    expect(refused.error).toBe(true);
    expect(refused.text).toMatch(/^read_only:/);
    expect(refused.text).toMatch(/NEXGEN_WRITE=1/);
  });

  it('acts as the person, who sees nothing of an organisation they were never invited to', async () => {
    const stranger = await clientAs({ kind: 'user', userId: USER_B });
    expect((await call(stranger, 'list_projects')).value).toEqual([]);
    const refused = await call(stranger, 'create_project', { organisation_id: org, name: 'Mine now', country: 'BE' });
    expect(refused.error).toBe(true);
    expect(refused.text).toMatch(/row-level security/);
  });

  it('acts as the issuer of a key, read only without write', async () => {
    const key = await asUser(db, USER_A, () => one<{ secret: string }>(db, `select secret from nexgen.create_api_key($1, 'Agent', array['data.read'])`, [org]));
    const agent = await clientAs({ kind: 'key', secret: key.secret });
    expect((await call(agent, 'status')).value.acting_as).toBe(USER_A);
    const refused = await call(agent, 'create_project', { organisation_id: org, name: 'By a key', country: 'BE' });
    expect(refused.text).toMatch(/^read_only:/);
    const revoked = await clientAs({ kind: 'key', secret: 'ngk_unknown_00' });
    expect((await call(revoked, 'status')).text).toMatch(/^api_key_unknown:/);
  });

  it('names a country never assumed, a computation not loaded, and invalid arguments', async () => {
    expect((await call(writer, 'create_project', { organisation_id: org, name: 'Nowhere', country: '' })).text).toMatch(/Input validation error|^invalid_arguments:/);
    const [project] = (await call(writer, 'list_projects', { organisation_id: org })).value;
    const [school] = (await call(writer, 'list_participants', { project_id: project.id })).value;
    const sized = await call(writer, 'solar_size', {
      participantId: school.id, criterion: 'self_consumption_rate', target: 0.6, from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z',
      step: '1 hour', shape: { seriesId: school.id, kwp: 1 },
    });
    expect(sized.text).toMatch(/^computation_not_loaded:/);
  });
});

describe('the configuration', () => {
  const SERVICE_ROLE = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.sig`;

  it('refuses a service_role key in every slot', () => {
    for (const name of ['SUPABASE_ANON_KEY', 'NEXGEN_ACCESS_TOKEN', 'NEXGEN_API_KEY']) {
      expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_ACT_AS_USER_ID: USER_A, [name]: SERVICE_ROLE }))
        .toThrow(/^service_role_refused:/);
    }
    expect(() => readConfig({ NEXGEN_API_KEY: 'sb_secret_abc' })).toThrow(/^service_role_refused:/);
  });

  it('wants one person to act as, and the session a token is verified with', () => {
    expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x' })).toThrow(/^missing_credentials:/);
    expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_ACT_AS_USER_ID: USER_A, NEXGEN_API_KEY: 'ngk_a_b' })).toThrow(/^two_credentials:/);
    expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_ACCESS_TOKEN: 'a.b.c' })).toThrow(/^missing_configuration:/);
    expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_ACT_AS_USER_ID: 'admin' })).toThrow(/^bad_act_as_user:/);
    expect(() => readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_API_KEY: 'secret' })).toThrow(/^bad_api_key:/);
    expect(readConfig({ NEXGEN_DB_URL: 'postgresql://localhost/x', NEXGEN_API_KEY: 'ngk_a_b', NEXGEN_WRITE: '1' }))
      .toEqual({ dbUrl: 'postgresql://localhost/x', acting: { kind: 'key', secret: 'ngk_a_b' }, writable: true });
  });

  it('starts with nothing set, lists its tools, and every call says what to configure', async () => {
    const { server, summary } = await serverFromEnvironment({});
    expect(summary).toMatch(/started without a database/);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
    const r = await call(client, 'list_organisations');
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/^not_configured:/);
    expect(r.text).toMatch(/NEXGEN_DB_URL/);
    await expect(serverFromEnvironment({ SUPABASE_ANON_KEY: SERVICE_ROLE })).rejects.toThrow(/^service_role_refused:/);
  });
});
