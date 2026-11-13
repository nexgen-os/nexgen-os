// The gestures as commands: the same functions as the MCP tools, run as a
// person under row level security, with `--json` and refusals by name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { main } from '../src/index.js';
import { USER_A, USER_B, freshDatabase, organisation, sqlClient } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;

async function run(argv: string[], env: Record<string, string> = { NEXGEN_ACT_AS_USER_ID: USER_A }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    out: (l) => out.push(l), err: (l) => err.push(l),
    env: { NEXGEN_DB_URL: 'pglite://', ...env }, open: async () => sqlClient(db),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const json = async (argv: string[], env?: Record<string, string>) => {
  const r = await run([...argv, '--json'], env);
  expect(r.err).toBe('');
  return JSON.parse(r.out);
};

beforeAll(async () => {
  db = await freshDatabase(['kpis']);
  org = await organisation(db, 'A cooperative', USER_A);
  await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [USER_B]);
  await db.query(`insert into nexgen.sources (code, name, kind) values ('zz_home', 'Testland home export', 'file')`);
});

afterAll(async () => {
  await db.close();
});

describe('the gestures as commands', () => {
  it('describes a place: a project, a participant, a meter, a device, an import', async () => {
    const project = await json(['project', 'create', '--organisation', org, '--name', 'Rooftops', '--country', 'ZZ']);
    const participant = await json(['participant', 'add', '--project', project.id, '--name', 'School', '--time-zone', 'Europe/Brussels',
      '--place', JSON.stringify({ country: 'ZZ', geometry: { type: 'Point', coordinates: [4.35, 50.85, 0] }, location_precision: 'street' })]);
    const meter = await json(['meter', 'declare', '--participant', participant.id, '--identifier', '541448000000000001', '--scheme', 'gs1_gsrn']);
    expect(meter.id).toMatch(/^[0-9a-f-]{36}$/);
    const device = await json(['device', 'install', '--participant', participant.id, '--type', 'solar', '--name', 'Roof array', '--power', '9']);
    expect(device.id).toMatch(/^[0-9a-f-]{36}$/);

    const dir = await mkdtemp(join(tmpdir(), 'nexgen-gestures-'));
    const file = join(dir, 'home.json');
    await writeFile(file, JSON.stringify({
      floors: [], areas: [], devices: [],
      entities: [{ entity_id: 'sensor.grid_import', unique_id: 'u1', platform: 'p1', name: null, original_name: 'Grid import', device_id: null, area_id: null,
        device_class: 'energy', original_device_class: null, state_class: 'total_increasing', unit_of_measurement: 'kWh', icon: null, entity_category: null, disabled_by: null }],
      states: [{ entity_id: 'sensor.grid_import', state: '10.5', last_updated: '2026-01-01T00:00:00Z' }, { entity_id: 'sensor.grid_import', state: 'unavailable', last_updated: '2026-01-01T01:00:00Z' },
        { entity_id: 'sensor.grid_import', state: '12', last_updated: '2026-01-01T02:00:00Z' }],
    }));
    const imported = await json(['series', 'import', '--format', 'homeassistant', '--file', file, '--entity', 'sensor.grid_import',
      '--organisation', org, '--object-kind', 'meter', '--object', meter.id, '--quantity', 'offtake_energy', '--source', 'zz_home']);
    expect(imported.inserted).toBe(2);

    const human = await run(['kpis', '--object-kind', 'participant', '--object', participant.id, '--from', '2026-01-01T00:00:00Z', '--to', '2026-02-01T00:00:00Z']);
    expect(human.code).toBe(0);
  });

  it('imports a project from its description, writes nothing on a dry run, and finds it again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexgen-gestures-'));
    const file = join(dir, 'project.json');
    await writeFile(file, JSON.stringify({
      name: 'Market hall', country: 'ZZ',
      participants: [{ name: 'Hall', time_zone: 'Europe/Brussels',
        place: { country: 'ZZ', geometry: { type: 'Point', coordinates: [4.36, 50.84, 0] }, location_precision: 'street' },
        meters: [{ identifier: '541448000000000055', scheme: 'gs1_gsrn' }] }],
    }));
    const plan = await json(['project', 'import', '--organisation', org, '--file', file, '--dry-run']);
    expect(plan.dry_run).toBe(true);
    expect(plan.counts.participant).toEqual({ found: 0, created: 1 });
    expect((await db.query(`select 1 from nexgen.projects where name = 'Market hall'`)).rows).toHaveLength(0);
    const done = await json(['project', 'import', '--organisation', org, '--file', file]);
    expect(done.project_id).toMatch(/^[0-9a-f-]{36}$/);
    const again = await json(['project', 'import', '--organisation', org, '--file', file]);
    expect(again.counts).toEqual({ project: { found: 1, created: 0 }, participant: { found: 1, created: 0 }, meter: { found: 1, created: 0 }, device: { found: 0, created: 0 } });
  });

  it('imports a project sheet a spreadsheet saved, and names the cell it cannot read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexgen-gestures-'));
    const file = join(dir, 'project.csv');
    const sheet = (power: string) => [
      'project;country;participant;time_zone;participant_country;latitude;longitude;location_precision;meter_scheme;meter_identifier;device_type;device_name;device_rated_power_kw',
      `Covered market;ZZ;Stall;Europe/Brussels;ZZ;50,84;4,36;street;gs1_gsrn;541448000000000062;inverter;Stall inverter;${power}`,
    ].join('\r\n');
    await writeFile(file, sheet('3,5'));
    const plan = await json(['project', 'import', '--organisation', org, '--file', file, '--dry-run']);
    expect(plan.projects[0].counts.device).toEqual({ found: 0, created: 1 });
    const done = await json(['project', 'import', '--organisation', org, '--file', file]);
    expect(done.projects[0].project_id).toMatch(/^[0-9a-f-]{36}$/);
    await writeFile(file, sheet('three'));
    const refused = await run(['project', 'import', '--organisation', org, '--file', file]);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toMatch(/sheet_unreadable: line 2 invalid_number device_rated_power_kw "three"/);
  });

  it('issues, lists and withdraws a key, and the key acts as its issuer', async () => {
    const key = await json(['key', 'create', '--organisation', org, '--name', 'Nightly import']);
    expect(key.capabilities).toEqual(['data.read']);
    const listed = await run(['key', 'list', '--organisation', org]);
    expect(listed.out).toContain(key.prefix);
    expect(listed.out).not.toContain(key.secret);
    const asKey = await run(['project', 'create', '--organisation', org, '--name', 'By a key', '--country', 'ZZ'], { NEXGEN_API_KEY: key.secret });
    expect(asKey.code).toBe(1);
    expect(asKey.err).toMatch(/^read_only:/);
    expect((await run(['key', 'revoke', key.api_key_id])).code).toBe(0);
    expect((await run(['kpis', '--object-kind', 'project', '--object', org, '--from', '2026-01-01', '--to', '2026-02-01'], { NEXGEN_API_KEY: key.secret })).err)
      .toMatch(/^api_key_revoked:/);
  });

  it('creates an organisation and gives its members their roles, as its owner', async () => {
    const created = await json(['organisation', 'create', '--name', 'A new installation'], { NEXGEN_ACT_AS_USER_ID: USER_B });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const asB = { NEXGEN_ACT_AS_USER_ID: USER_B };
    expect(await json(['member', 'list', '--organisation', created.id], asB)).toEqual([expect.objectContaining({ user_id: USER_B, role: 'owner' })]);

    expect((await run(['member', 'list', '--organisation', created.id])).out).toBe('nothing');
    const added = await json(['member', 'add', '--organisation', created.id, '--user', USER_A], asB);
    expect(added).toEqual({ organisation_id: created.id, user_id: USER_A, role: 'viewer' });
    expect((await run(['member', 'add', '--organisation', created.id, '--user', USER_A], asB)).err).toMatch(/^already_member:/);
    expect((await run(['member', 'role', '--organisation', created.id, '--user', USER_B, '--role', 'editor'], asB)).err).toMatch(/^last_owner:/);
    expect((await run(['member', 'remove', '--organisation', created.id, '--user', USER_B], asB)).err).toMatch(/^last_owner:/);

    expect((await json(['member', 'role', '--organisation', created.id, '--user', USER_A, '--role', 'owner'], asB)).role).toBe('owner');
    expect((await json(['member', 'remove', '--organisation', created.id, '--user', USER_B])).removed).toBe(true);
    expect(await json(['member', 'list', '--organisation', created.id])).toEqual([expect.objectContaining({ user_id: USER_A, role: 'owner' })]);
  });

  it('refuses by name: nobody to act as, a stranger, a computation not loaded, an address without a geocoder', async () => {
    expect((await run(['project', 'create', '--organisation', org, '--name', 'X', '--country', 'ZZ'], {})).err).toMatch(/^missing_credentials:/);
    const stranger = await run(['project', 'create', '--organisation', org, '--name', 'X', '--country', 'ZZ'], { NEXGEN_ACT_AS_USER_ID: USER_B });
    expect(stranger.err).toMatch(/row-level security/);
    const dir = await mkdtemp(join(tmpdir(), 'nexgen-gestures-'));
    await writeFile(join(dir, 'request.json'), '{}');
    expect((await run(['size', '--module', 'solar', '--request', join(dir, 'request.json')])).err).toMatch(/^module_not_installed:/);
    const [project] = (await db.query<{ id: string }>('select id from nexgen.projects limit 1')).rows;
    expect((await run(['participant', 'add', '--project', project!.id, '--name', 'Library', '--address', '1 Main Street'])).err)
      .toMatch(/^geocoder_not_configured:/);
    expect((await run(['meter', 'declare'])).code).toBe(2);
  });
});
