// The `energy_sharing` engine contract: the example engine
// (engines/sharing-example, pure Python) on a day of three participants
// whose result is written by hand in JSON, its named refusals, and a run of
// the `sharing` module on the energy community of example 3, recorded with
// the engine's version and stored as series on the participants. Without
// Python, the engine's tests are skipped and say so.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { SHARING_EXAMPLE_ENGINE, type EnergySharingRequest, type EnergySharingResult } from '../engines/energy-sharing.js';
import { describeEngine, runEngine, type EngineSpec } from '../engines/runner.js';
import { runSharing } from '../modules/sharing/run.js';
import { USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const ORG = '00000000-0000-4000-8000-000300000001';
const PROJECT = '00000000-0000-4000-8000-000300000020';
const VAN_DIJK = '00000000-0000-4000-8000-000300000051';
const PLANT = '00000000-0000-4000-8000-000300000054';
const GROUP = '00000000-0000-4000-8000-000300000055';

// The engine from its folder, with the Python on the path: no installation needed.
const folder = join(repoRoot, 'engines', 'sharing-example');
const spec: EngineSpec = {
  ...SHARING_EXAMPLE_ENGINE,
  command: ['python3', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(folder)}); from nexgen_sharing_example.run import main; sys.exit(main())`],
};
const installed = await describeEngine(spec).catch(() => null);
const skipped = installed ? '' : ' (skipped: python3 is not on the path)';
const fake: EngineSpec = { name: 'fake', command: [process.execPath, join(repoRoot, 'tests', 'fixtures', 'engines', 'fake.mjs'), 'echo'] };

interface Fixture {
  request: EnergySharingRequest;
  expected: {
    totals: Record<string, number>;
    participants: Record<string, Record<string, number>>;
    steps: Record<string, Record<string, Record<string, number>>>;
  };
}
const fixture = JSON.parse(await readFile(join(repoRoot, 'tests', 'fixtures', 'engines', 'sharing-day.json'), 'utf8')) as Fixture;
const share = (request: EnergySharingRequest) => runEngine<EnergySharingRequest, EnergySharingResult>(spec, request);
const changed = (f: (r: EnergySharingRequest) => void): EnergySharingRequest => {
  const r = structuredClone(fixture.request);
  f(r);
  return r;
};

describe.skipIf(!installed)(`the example sharing engine${skipped}`, () => {
  it('describes itself: pure Python, the energy_sharing kind', () => {
    expect(installed).toMatchObject({ engine: 'sharing_example', version: 'sharing_example 0.1.0', kinds: ['energy_sharing'] });
    expect(Object.keys(installed!.dependencies)).toEqual(['nexgen_sharing_example', 'python']);
  });

  it('shares a day of three participants in proportion to offtake, as written by hand', async () => {
    const { version, result } = await share(fixture.request);
    expect(version).toBe('sharing_example 0.1.0');
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

describe('energy sharing in a project, as a run', () => {
  let db: PGlite;
  let key: string;
  const day = { from: '2026-05-02T00:00:00+02:00', to: '2026-05-03T00:00:00+02:00', step: '15 minutes' };

  beforeAll(async () => {
    db = await freshDatabase(['sharing']);
    await db.exec(await readFile(join(repoRoot, 'examples', '03-energy-community.sql'), 'utf8'));
    key = await insert(db, 'sharing.allocation_keys', {
      organisation_id: ORG, project_id: PROJECT, name: 'Key 2026', method: 'proportional', valid_from: '2026-01-01', valid_to: '2027-01-01', source: 'general assembly',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it.skipIf(!installed)('hands the participants\' metered offtake and injection to the engine and stores its answer on each participant', async () => {
    const r = await runSharing(db, { projectId: PROJECT, keyId: key, ...day, engine: spec });
    expect(r.engine).toBe('sharing_example 0.1.0');
    // Four participants behind a meter; the group's meters are its members'.
    expect(Object.keys(r.series).sort()).toEqual(['00000000-0000-4000-8000-000300000051', '00000000-0000-4000-8000-000300000052', '00000000-0000-4000-8000-000300000053', PLANT]);
    expect(r.series[GROUP]).toBeUndefined();

    // Step by step, what the consumers received is what the plant gave, and what is left adds back to the meters.
    const read = async (participant: string, quantity: string) =>
      (await db.query<{ value: number }>('select value from resample($1, $2, $3, $4)', [r.series[participant][quantity], day.from, day.to, day.step])).rows.map((v) => v.value);
    const metered = async (meterSeries: string) =>
      (await db.query<{ value: number }>('select value from resample($1, $2, $3, $4)', [meterSeries, day.from, day.to, day.step])).rows.map((v) => v.value);
    const received = await Promise.all(Object.keys(r.series).map((p) => read(p, 'shared_offtake_energy')));
    const given = await read(PLANT, 'shared_injection_energy');
    expect(given).toHaveLength(96);
    given.forEach((g, i) => expect(received.reduce((sum, p) => sum + p[i], 0)).toBeCloseTo(g, 4));
    const injected = await metered('00000000-0000-4000-8000-000300000074');
    const left = await read(PLANT, 'injection_energy');
    injected.forEach((v, i) => expect(left[i] + given[i]).toBeCloseTo(v, 5));
    const vanDijkMetered = await metered('00000000-0000-4000-8000-000300000071');
    const vanDijkLeft = await read(VAN_DIJK, 'offtake_energy');
    const vanDijkReceived = await read(VAN_DIJK, 'shared_offtake_energy');
    vanDijkMetered.forEach((v, i) => expect(vanDijkLeft[i] + vanDijkReceived[i]).toBeCloseTo(v, 5));
    expect(r.sharedKwh).toBeCloseTo(given.reduce((a, b) => a + b, 0), 3);

    const series = await one<{ kind: string; source: string; object_id: string }>(db, 'select kind, source, object_id from series where id = $1', [r.series[VAN_DIJK].shared_offtake_energy]);
    expect(series).toEqual({ kind: 'simulated', source: 'sharing_example 0.1.0', object_id: VAN_DIJK });
  });

  it.skipIf(!installed)('is a run that names its engine, its key, its period and the series it read; the same inputs give the same run', async () => {
    const first = await runSharing(db, { projectId: PROJECT, keyId: key, ...day, engine: spec });
    const again = await runSharing(db, { projectId: PROJECT, keyId: key, ...day, engine: spec });
    expect(again.runId).toBe(first.runId);
    const run = await one<{ module_code: string; engine_version: string; subject_id: string; inputs: Record<string, any>; results: Record<string, any> }>(
      db, 'select module_code, engine_version, subject_id, inputs, results from runs where id = $1', [first.runId],
    );
    expect(run).toMatchObject({ module_code: 'sharing', engine_version: 'sharing_example 0.1.0', subject_id: PROJECT });
    expect(run.inputs.engine).toMatchObject({ name: 'sharing_example', version: 'sharing_example 0.1.0', contract: 1 });
    expect(run.inputs.key).toMatchObject({ id: key, name: 'Key 2026', method: 'proportional', valid_from: '2026-01-01', valid_to: '2027-01-01' });
    expect(run.inputs.period).toEqual({ from: '2026-05-01T22:00:00Z', to: '2026-05-02T22:00:00Z', step: '15 minutes' });
    const plant = run.inputs.participants.find((p: { id: string }) => p.id === PLANT);
    expect(plant.series).toEqual({ offtake_energy: [], injection_energy: ['00000000-0000-4000-8000-000300000074'] });
    expect(run.results.totals.steps).toBe(96);
    expect(run.results.meta.key).toEqual({ method: 'proportional', basis: 'offtake' });
  });

  it.skipIf(!installed)('refuses a period its meters do not cover, and passes on the engine\'s own refusals', async () => {
    await expect(runSharing(db, { projectId: PROJECT, keyId: key, from: '2026-05-31T21:00:00Z', to: '2026-06-01T01:00:00Z', step: '15 minutes', engine: spec }))
      .rejects.toThrow(/^series_incomplete: offtake_energy of .* misses 12 of 16 steps/);
    await expect(runSharing(db, { projectId: PROJECT, keyId: key, ...day, rules: { max_hours: 1100 }, engine: spec })).rejects.toThrow(/^rule_unknown: max_hours/);
  });

  it('refuses what it cannot hand to an engine, before starting one', async () => {
    await expect(runSharing(db, { projectId: PROJECT, keyId: PROJECT, ...day, engine: spec })).rejects.toThrow(/^key_not_found/);
    await expect(runSharing(db, { projectId: PROJECT, keyId: key, ...day, from: '2026-05-02T00:07:00Z', engine: spec })).rejects.toThrow(/^period_misaligned/);
    await expect(runSharing(db, { projectId: PROJECT, keyId: key, from: '2025-05-02T00:00:00Z', to: '2025-05-03T00:00:00Z', step: '1 hour', engine: spec })).rejects.toThrow(/^key_outside_period: Key 2026/);
    await expect(runSharing(db, { projectId: PROJECT, keyId: key, ...day, engine: fake })).rejects.toThrow(/^engine_kind_unsupported: fake accepts echo, pv_yield, not energy_sharing$/);
  });

  it('keeps the keys to the organisation of their project', async () => {
    await organisation(db, 'Another cooperative', USER_B);
    await asUser(db, USER_B, async () => {
      expect((await db.query('select id from sharing.allocation_keys')).rows).toEqual([]);
    });
    const other = (await one<{ id: string }>(db, `select id from organisations where name = 'Another cooperative'`)).id;
    await expect(insert(db, 'sharing.allocation_keys', { organisation_id: other, project_id: PROJECT, name: 'Stolen', method: 'proportional' })).rejects.toThrow(/project_in_other_organisation/);
    await expect(insert(db, 'sharing.allocation_keys', { organisation_id: ORG, project_id: PROJECT, name: 'Bad', method: 'Pro rata' })).rejects.toThrow(/allocation_keys_method_format/);
  });
});
