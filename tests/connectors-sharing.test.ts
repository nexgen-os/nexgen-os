// The `energy_sharing` engine contract: the example engine
// (packages/connectors/sharing-example, pure Python) on a day of three participants
// whose result is written by hand in JSON, its named refusals, and a settlement of
// the `community` module on the energy community of example 3, its key an
// attribute of the project, recorded with the engine's version and stored
// as series of the settlement on the participants. Without Python, the engine's
// tests are skipped and say so.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { SHARING_EXAMPLE_ENGINE, describeEngine, runEngine, type EnergySharingRequest, type EnergySharingResult, type EngineSpec } from '@nexgen-os/core';
import { settleSharing } from '../modules/community/src/sharing.js';
import { USER_B, asUser, freshDatabase, one, organisation, repoRoot } from './helpers/db.js';

const PROJECT = '00000000-0000-4000-8000-000300000020';
const VAN_DIJK = '00000000-0000-4000-8000-000300000051';
const PLANT = '00000000-0000-4000-8000-000300000054';
const GROUP = '00000000-0000-4000-8000-000300000055';

// The engine from its folder, with the Python on the path: no installation needed.
const folder = join(repoRoot, 'packages', 'connectors', 'sharing-example');
const spec: EngineSpec = {
  ...SHARING_EXAMPLE_ENGINE,
  command: ['python3', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(folder)}); from nexgen_sharing_example.run import main; sys.exit(main())`],
};
const installed = await describeEngine(spec).catch(() => null);
const skipped = installed ? '' : ' (skipped: python3 is not on the path)';
const fake: EngineSpec = { name: 'fake', command: [process.execPath, join(repoRoot, 'tests', 'fixtures', 'connectors', 'fake.mjs'), 'echo'] };

interface Fixture {
  request: EnergySharingRequest;
  expected: {
    totals: Record<string, number>;
    participants: Record<string, Record<string, number>>;
    steps: Record<string, Record<string, Record<string, number>>>;
  };
}
const fixture = JSON.parse(await readFile(join(repoRoot, 'tests', 'fixtures', 'connectors', 'sharing-day.json'), 'utf8')) as Fixture;
const share = (request: EnergySharingRequest) => runEngine<EnergySharingRequest, EnergySharingResult>(spec, request);
const changed = (f: (r: EnergySharingRequest) => void): EnergySharingRequest => {
  const r = structuredClone(fixture.request);
  f(r);
  return r;
};

describe.skipIf(!installed)(`the example sharing engine${skipped}`, () => {
  it('describes itself: pure Python, the energy_sharing kind', () => {
    expect(installed).toMatchObject({ engine: 'sharing_example', version: 'sharing_example 0.3.0', kinds: ['energy_sharing'] });
    expect(Object.keys(installed!.dependencies)).toEqual(['nexgen_sharing_example', 'python']);
  });

  it('shares a day of three participants in proportion to offtake, as written by hand', async () => {
    const { version, result } = await share(fixture.request);
    expect(version).toBe('sharing_example 0.3.0');
    expect(result.totals).toEqual(fixture.expected.totals);
    for (const p of result.participants) expect(p.totals).toEqual(fixture.expected.participants[p.id]);
    for (const [at, byParticipant] of Object.entries(fixture.expected.steps)) {
      for (const [id, quantities] of Object.entries(byParticipant)) {
        const answered = result.participants.find((p) => p.id === id)!;
        for (const [quantity, value] of Object.entries(quantities)) {
          expect(answered.series.find((s) => s.quantity_code === quantity)!.values.find((v) => v.at === at)!.value, `${id} ${quantity} at ${at}`).toBe(value);
        }
      }
    }
    expect(result.meta).toEqual({ key: { method: 'proportional', basis: 'offtake' }, rules: {} });
  });

  it('answers series a caller stores without translation, on the grid of the request', async () => {
    const { result } = await share(fixture.request);
    for (const p of result.participants) {
      expect(p.series.map((s) => s.quantity_code)).toEqual(['shared_offtake_energy', 'shared_injection_energy', 'offtake_energy', 'injection_energy']);
      for (const s of p.series) {
        expect(s).toMatchObject({ value_kind: 'interval', step: '1 hour', unit: 'kWh' });
        expect(s.values.map((v) => v.at)).toEqual(fixture.request.participants[0].series[0].values.map((v) => v.at));
      }
    }
  });

  it('refuses by name what it cannot share', async () => {
    await expect(share(changed((r) => { r.key.method = 'fixed'; }))).rejects.toThrow(/^key_unknown: 'fixed'; this engine shares by proportional$/);
    await expect(share(changed((r) => { r.rules = { max_hours: 1100 }; }))).rejects.toThrow(/^rule_unknown: max_hours; this engine applies no rule$/);
    await expect(share(changed((r) => { r.participants = []; }))).rejects.toThrow(/^participants_missing/);
    await expect(share(changed((r) => { r.participants[1].series[0].values[3].at = '2026-05-02T03:30:00Z'; }))).rejects.toThrow(/^series_misaligned: offtake_energy of participant b/);
    await expect(share(changed((r) => { r.participants[2].series.pop(); }))).rejects.toThrow(/^series_missing: participant p has no injection_energy series$/);
  });
});

describe('energy sharing in a project, as a settlement', () => {
  let db: PGlite;
  const day = { from: '2026-05-02T00:00:00+02:00', to: '2026-05-03T00:00:00+02:00', step: '15 minutes' };

  beforeAll(async () => {
    db = await freshDatabase(['billing', 'community', 'grid']);
    await db.exec(await readFile(join(repoRoot, 'docs', 'demo', '03-energy-community.sql'), 'utf8'));
    await db.query(
      `insert into attributes (object_kind, object_id, property_code, value, valid_from, valid_to, source)
       values ('project', $1, 'allocation_key', '{"method": "proportional", "parameters": {}}', '2026-01-01T00:00:00+01:00', '2027-01-01T00:00:00+01:00', 'general assembly 2025')`,
      [PROJECT],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it.skipIf(!installed)('hands the participants\' metered offtake and injection to the engine and stores its answer on each participant', async () => {
    const r = await settleSharing(db, { projectId: PROJECT, ...day, engine: spec });
    expect(r.engine).toBe('sharing_example 0.3.0');
    // Four participants behind a meter; the group's meters are its members'.
    expect(Object.keys(r.series).sort()).toEqual(['00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000052', '00000000-0000-4000-8000-000300000053', PLANT]);
    expect(r.series[GROUP]).toBeUndefined();

    // Step by step, what the consumers received is what the plant gave, and what is left adds back to the meters.
    const read = async (series: string) =>
      (await db.query<{ value: number }>('select value from resample($1, $2, $3, $4)', [series, day.from, day.to, day.step])).rows.map((v) => v.value);
    const received = await Promise.all(Object.keys(r.series).map((p) => read(r.series[p].shared_offtake_energy)));
    const given = await read(r.series[PLANT].shared_injection_energy);
    expect(given).toHaveLength(96);
    given.forEach((g, i) => expect(received.reduce((sum, p) => sum + p[i], 0)).toBeCloseTo(g, 4));
    const injected = await read('00000000-0000-4000-8000-000300000074');
    const left = await read(r.series[PLANT].injection_energy);
    injected.forEach((v, i) => expect(left[i] + given[i]).toBeCloseTo(v, 5));
    const vanDijkMetered = await read('00000000-0000-4000-8000-000300000071');
    const vanDijkLeft = await read(r.series[VAN_DIJK].offtake_energy);
    const vanDijkReceived = await read(r.series[VAN_DIJK].shared_offtake_energy);
    vanDijkMetered.forEach((v, i) => expect(vanDijkLeft[i] + vanDijkReceived[i]).toBeCloseTo(v, 5));
    expect(r.sharedKwh).toBeCloseTo(given.reduce((a, b) => a + b, 0), 3);

    const series = await one<{ kind: string; object_id: string; source: string }>(db, 'select kind, object_id, source from series where id = $1', [r.series[VAN_DIJK].shared_offtake_energy]);
    expect(series).toEqual({ kind: 'simulated', object_id: VAN_DIJK, source: `community.settlements:${r.settlementId}` });
  });

  it.skipIf(!installed)('is a settlement that names its engine, its key, its period and the series it read; a new computation replaces the one it names', async () => {
    const earlier = await settleSharing(db, { projectId: PROJECT, ...day, engine: spec });
    const first = await settleSharing(db, { projectId: PROJECT, ...day, engine: spec, replaces: earlier.settlementId });
    expect(first.settlementId).toBe(earlier.settlementId);
    expect(first.sharedKwh).toBeCloseTo(earlier.sharedKwh, 9);
    const settlement = await one<{ provenance: string; project_id: string; inputs: Record<string, any>; results: Record<string, any> }>(
      db, 'select provenance, project_id, inputs, results from community.settlements where id = $1', [first.settlementId],
    );
    expect(settlement).toMatchObject({ provenance: 'sharing_example 0.3.0', project_id: PROJECT });
    expect(settlement.inputs.engine).toMatchObject({ name: 'sharing_example', version: 'sharing_example 0.3.0', contract: 1 });
    expect(settlement.inputs.key).toEqual({
      method: 'proportional', parameters: {}, valid_from: '2025-12-31T23:00:00Z', valid_to: '2026-12-31T23:00:00Z', source: 'general assembly 2025', source_code: null,
    });
    expect(settlement.inputs.period).toEqual({ from: '2026-05-01T22:00:00Z', to: '2026-05-02T22:00:00Z', step: '15 minutes' });
    const plant = settlement.inputs.participants.find((p: { id: string }) => p.id === PLANT);
    expect(plant.series).toEqual({ offtake_energy: [], injection_energy: ['00000000-0000-4000-8000-000300000074'] });
    expect(settlement.results.totals.steps).toBe(96);
    expect(settlement.results.meta.key).toEqual({ method: 'proportional', basis: 'offtake' });
    // The series of the settlement it replaced were written again.
    expect((await db.query('select id from series where id = $1', [earlier.series[PLANT].injection_energy])).rows).toEqual([]);
  });

  it.skipIf(!installed)('hands each participant its attributes, for a key that reads them', async () => {
    await db.query(`insert into attributes (object_kind, object_id, property_code, value, source) values ('participant', $1, 'allocation_share', '0.4', 'general assembly 2025')`, [VAN_DIJK]);
    const r = await settleSharing(db, { projectId: PROJECT, ...day, engine: spec });
    const settlement = await one<{ inputs: Record<string, any> }>(db, 'select inputs from community.settlements where id = $1', [r.settlementId]);
    expect(settlement.inputs.participants.find((p: { id: string }) => p.id === VAN_DIJK).attributes).toEqual({ allocation_share: 0.4 });
    await expect(db.query(`insert into attributes (object_kind, object_id, property_code, value) values ('participant', $1, 'allocation_share', '1.5')`, ['00000000-0000-4000-8000-000300000052']))
      .rejects.toThrow(/allocation_share/);
  });

  it.skipIf(!installed)('refuses a period its meters do not cover, and passes on the engine\'s own refusals', async () => {
    await expect(settleSharing(db, { projectId: PROJECT, from: '2026-05-31T21:00:00Z', to: '2026-06-01T01:00:00Z', step: '15 minutes', engine: spec }))
      .rejects.toThrow(/^series_incomplete: offtake_energy of .* misses 12 of 16 steps/);
    await expect(settleSharing(db, { projectId: PROJECT, ...day, rules: { max_hours: 1100 }, engine: spec })).rejects.toThrow(/^rule_unknown: max_hours/);
  });

  it('refuses what it cannot hand to an engine, before starting one', async () => {
    await expect(settleSharing(db, { projectId: VAN_DIJK, ...day, engine: spec })).rejects.toThrow(/^project_not_found/);
    await expect(settleSharing(db, { projectId: PROJECT, ...day, from: '2026-05-02T00:07:00Z', engine: spec })).rejects.toThrow(/^period_misaligned/);
    await expect(settleSharing(db, { projectId: PROJECT, from: '2025-05-02T00:00:00Z', to: '2025-05-03T00:00:00Z', step: '1 hour', engine: spec })).rejects.toThrow(/^key_required/);
    await expect(settleSharing(db, { projectId: PROJECT, from: '2026-12-31T00:00:00Z', to: '2027-01-02T00:00:00Z', step: '1 hour', engine: spec })).rejects.toThrow(/^key_outside_period/);
    await expect(settleSharing(db, { projectId: PROJECT, ...day, engine: fake })).rejects.toThrow(/^engine_kind_unsupported: fake accepts echo, pv_yield, not energy_sharing$/);
    await db.query(
      `insert into attributes (object_kind, object_id, property_code, value, valid_from, source) values ('project', $1, 'allocation_key', '{"method": "fixed", "parameters": {}}', '2027-01-01T00:00:00+01:00', 'general assembly 2026')`,
      [PROJECT],
    );
    await expect(settleSharing(db, { projectId: PROJECT, from: '2026-12-31T00:00:00Z', to: '2027-01-02T00:00:00Z', step: '1 hour', engine: spec })).rejects.toThrow(/^key_changes_in_period/);
  });

  it('keeps the key and the settlement to the organisation of the project', async () => {
    await organisation(db, 'Another cooperative', USER_B);
    await asUser(db, USER_B, async () => {
      expect((await db.query(`select id from attributes where property_code = 'allocation_key'`)).rows).toEqual([]);
      await expect(settleSharing(db, { projectId: PROJECT, ...day, engine: spec })).rejects.toThrow(/^project_not_found/);
    });
  });
});
