// The golden cases of every country pack, replayed by one runner.
//
// A pack is data, and data that compiles says nothing about whether the
// functions that read it give the right answer. What catches that is a case
// whose figures somebody worked out by hand: `packs/<cc>/golden/<case>/`, a
// scenario (an organisation, a project of a kind, its participants with
// their segment and municipality, their meters and devices, a few hours of
// series) and the figures a correct installation must find from it — the
// defaults resolved with their level and condition, the perimeter verdict
// of each participant, the operator of each meter, the shares of a
// settlement, a PV yield within its tolerance, the indicators.
//
// Nothing here knows a country. The runner reads `packs/`, installs every
// module and every pack, builds each case through the gestures a caller
// uses (`join_project`, `declare_meter`, `install_device`, `store`), and
// compares what `parameter_of()`, `storage.battery_of()`,
// `community.check_perimeter()`, `grid.operator_of()`, `settleSharing()`,
// the PVWatts model of `solar` and `kpis.measure()` answer with the file.
// A new pack only adds files; `nexgen-os pack check` checks their shape.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { packFolders, readGoldens, readPack, readSchema, type GoldenCase } from '../packages/cli/src/index.js';
import { settleSharing } from '../modules/community/src/sharing.js';
import { arrayEnergy, remainingAfterLosses } from '../modules/solar/src/pvwatts.js';
import { freshDatabase, one, organisation, repoRoot, shippedModules } from './helpers/db.js';
import { installed, sharingExample } from './helpers/engines.js';

const schema = await readSchema(repoRoot);
const packs = await packFolders(repoRoot);
const cases: { pack: string; golden: GoldenCase }[] = [];
for (const slug of packs) {
  const { pack } = await readPack(repoRoot, slug, schema);
  if (!pack) throw new Error(`packs/${slug} does not read; run nexgen-os pack check ${slug}`);
  const { cases: found, problems } = await readGoldens(repoRoot, slug, {
    country: pack.manifest.country, frames: pack.project_kinds.map((k) => k.code), exempt: pack.manifest.golden?.exempt ?? null,
  });
  if (problems.length > 0) throw new Error(problems.map((p) => `${p.code}: ${p.detail}`).join('\n'));
  for (const golden of found) cases.push({ pack: slug, golden });
}
const engine = await installed(sharingExample);
const skipped = engine ? '' : ' (skipped: python3 is not on the path)';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(shippedModules, packs);
});

afterAll(async () => {
  await db?.close();
});

/** The ids of a case's objects by their `kind:ref`, and `project`. */
type Ids = Map<string, string>;

const stepMs = (step: string) => {
  const m = /^(\d+) (hour|minute)s?$/.exec(step);
  if (!m) throw new Error(`golden_step_unsupported: ${step}`);
  return Number(m[1]) * (m[2] === 'hour' ? 3_600_000 : 60_000);
};
const kindOf = (object: string) => (object === 'project' ? 'project' : object.split(':')[0]);
const idOf = (ids: Ids, object: string) => {
  const id = ids.get(object);
  if (!id) throw new Error(`golden_ref_unknown: ${object}`);
  return id;
};
const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    return (e as Error).message.split(':')[0];
  }
  return 'accepted';
};
const close = (actual: number | null | undefined, expected: number, tolerance: number) =>
  expect(Math.abs(Number(actual) - expected), `${actual} against ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);

/** Builds a case through the gestures a caller uses; returns the ids of its objects. */
async function build({ scenario: s, name }: GoldenCase, pack: string): Promise<Ids> {
  const ids: Ids = new Map();
  const org = await organisation(db, s.organisation);
  ids.set('project', (await one<{ id: string }>(db, 'insert into projects (organisation_id, name, kind, country) values ($1, $2, $3, $4) returning id',
    [org, s.project.name, s.project.kind, s.project.country])).id);
  for (const st of s.substations ?? []) {
    ids.set(`substation:${st.ref}`, (await one<{ id: string }>(db,
      `insert into grid.substations (operator, code, name, voltage_levels, published_by) values ($1, $2, $3, '{}', $4) returning id`,
      [st.operator, st.code, st.name, `golden:${pack}/${name}`])).id);
  }
  for (const p of s.participants) {
    const id = (await one<{ id: string }>(db, 'select join_project($1, $2, $3, $4) id', [ids.get('project'), p.name, JSON.stringify(p.place), p.role])).id;
    ids.set(`participant:${p.ref}`, id);
    if (p.segment) await db.query('update participants set segment = $2 where id = $1', [id, p.segment]);
    for (const m of p.meters ?? []) {
      const meter = (await one<{ id: string }>(db, 'select declare_meter($1, $2, $3) id', [id, m.identifier, m.scheme])).id;
      ids.set(`meter:${m.ref}`, meter);
      if (m.operator) {
        await db.query('select grid.connect_to_operator($1, $2, null, $3)', [meter, m.operator, m.substation ? ids.get(`substation:${m.substation}`) : null]);
      }
    }
    for (const d of p.devices ?? []) {
      const device = (await one<{ id: string }>(db, 'select install_device($1, $2, $3, null, $4) id', [id, d.type, d.name, d.rated_power_kw ?? null])).id;
      ids.set(`device:${d.ref}`, device);
      if (d.storage) {
        const cols = Object.keys(d.storage);
        await db.query(`insert into storage.devices (id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
          [device, ...cols.map((c) => d.storage![c])]);
      }
    }
  }
  for (const a of s.attributes ?? []) {
    await db.query(`insert into attributes (object_kind, object_id, attribute_type, value, valid_from, valid_to, source) values ($1, $2, $3, $4, $5, $6, $7)`,
      [kindOf(a.object), idOf(ids, a.object), a.attribute_type, JSON.stringify(a.value), a.valid_from ?? null, a.valid_to ?? null, a.source]);
  }
  const from = Date.parse(s.period.from);
  const step = stepMs(s.period.step);
  for (const x of s.series ?? []) {
    await db.query(
      `select store(null, $1::timestamptz[], $2::float8[], null, null, null,
                    jsonb_build_object('object_kind', $3::text, 'object_id', $4::uuid, 'quantity_code', $5::text, 'kind', $6::text, 'step', $7::text))`,
      [x.values.map((_, i) => new Date(from + i * step).toISOString()), x.values, kindOf(x.object), idOf(ids, x.object), x.quantity, x.kind ?? 'measured', s.period.step]);
  }
  return ids;
}

describe.each(packs)('the golden cases of packs/%s', (pack) => {
  const ofPack = cases.filter((c) => c.pack === pack);

  it('carries at least one case', () => {
    expect(ofPack.length).toBeGreaterThan(0);
  });

  describe.each(ofPack.map((c) => [c.golden.name, c.golden] as const))('%s', (_name, golden) => {
    const { scenario: s, expectations: e } = golden;
    let ids: Ids;
    const nameOf = (ref: string) => s.participants.find((p) => p.ref === ref)!.name;

    beforeAll(async () => {
      ids = await build(golden, pack);
    });

    it.runIf(e.defaults)('resolves each default at its level, for its condition, with its source', async () => {
      for (const d of e.defaults!) {
        const ask = () => one<{ p: Record<string, unknown> }>(db, 'select parameter_of($1, $2, $3, $4) p', [kindOf(d.object), idOf(ids, d.object), d.attribute_type, d.at]);
        if (d.refusal) {
          expect(await refusal(ask), `${d.attribute_type} of ${d.object}`).toBe(d.refusal);
          continue;
        }
        const { source: _source, object: _object, at: _at, attribute_type: _type, refusal: _refusal, ...answer } = d;
        expect((await ask()).p, `${d.attribute_type} of ${d.object}`).toMatchObject(answer);
      }
    });

    it.runIf(e.batteries)('says every figure of a battery and where it comes from', async () => {
      for (const b of e.batteries!) {
        const of = (await one<{ b: Record<string, unknown> }>(db, 'select storage.battery_of($1, $2) b', [idOf(ids, `device:${b.device}`), b.at])).b;
        expect(of).toMatchObject(b.figures);
      }
    });

    it.runIf(e.perimeter)('gives each participant its perimeter verdict, by the rule of its pack', async () => {
      const p = e.perimeter!;
      const ask = () => db.query<{ name: string; in_perimeter: boolean | null; criteria: Record<string, unknown>[]; rule: Record<string, unknown> }>(
        'select * from community.check_perimeter($1, $2)', [ids.get('project'), p.on]);
      if (p.refusal) {
        expect(await refusal(ask)).toBe(p.refusal);
        return;
      }
      const rows = new Map((await ask()).rows.map((r) => [r.name, r]));
      for (const [ref, want] of Object.entries(p.participants ?? {})) {
        const row = rows.get(nameOf(ref));
        expect(row?.in_perimeter, ref).toBe(want.in_perimeter);
        expect(row?.rule).toMatchObject(p.rule ?? {});
        (want.criteria ?? []).forEach((c, i) => {
          const { distance_m, ...rest } = c as { distance_m?: number };
          expect(row?.criteria[i], `${ref}, criterion ${i}`).toMatchObject(rest);
          if (distance_m !== undefined) close(row?.criteria[i].distance_m as number, distance_m, p.tolerance_m!);
        });
      }
    });

    it.runIf(e.operators)('finds the operator of each meter, from the most precise level up', async () => {
      for (const o of e.operators!) {
        const ask = () => one<{ o: Record<string, unknown> }>(db, 'select grid.operator_of($1) o', [idOf(ids, `meter:${o.meter}`)]);
        if (o.refusal) {
          expect(await refusal(ask), o.meter).toBe(o.refusal);
          continue;
        }
        const { source: _source, meter: _meter, refusal: _refusal, ...answer } = o;
        expect((await ask()).o, o.meter).toMatchObject(answer);
      }
    });

    it.runIf(e.solar)('computes the PV yield of its hours within the tolerance', async () => {
      const sol = s.solar!;
      const profile = await one<{ temperature_params: { u0: number; u1: number }; losses: { code: string; pct: number | null }[] }>(
        db, 'select temperature_params, losses from solar.yield_profiles where code = $1', [sol.profile]);
      const from = Date.parse(s.period.from);
      const at = (i: number) => new Date(from + i * stepMs(s.period.step)).toISOString();
      // The hours of the case are means over each hour, as the model reads them once aligned.
      const hours = sol.hours.map((h, i) => ({ at: at(i), ...h }));
      const energy = arrayEnergy(hours, { kwp: sol.kwp, gammaPdc: sol.gamma_pdc },
        { ...profile.temperature_params, remainingFraction: remainingAfterLosses(profile.losses) }).reduce((sum, h) => sum + h.value, 0);
      close(energy, e.solar!.energy_kwh, (e.solar!.energy_kwh * e.solar!.tolerance_pct) / 100);
    });

    it.runIf(e.settlement && engine)(`settles the sharing, participant by participant${skipped}`, async () => {
      const st = e.settlement!;
      const r = await settleSharing(db, { projectId: ids.get('project')!, from: s.period.from, to: s.period.to, step: s.period.step, engine: sharingExample });
      close(r.sharedKwh, st.shared_kwh, st.tolerance_kwh);
      const settled = await one<{ results: { participants: { id: string; totals: Record<string, number> }[] } }>(
        db, 'select results from community.settlements where id = $1', [r.settlementId]);
      for (const [ref, want] of Object.entries(st.participants)) {
        const totals = settled.results.participants.find((p) => p.id === ids.get(`participant:${ref}`))!.totals;
        close(totals.shared_offtake_energy, want.shared_offtake_energy, st.tolerance_kwh);
        close(totals.shared_injection_energy, want.shared_injection_energy, st.tolerance_kwh);
      }
    });

    it.runIf(e.kpis)('measures each indicator, saying what it read', async () => {
      for (const k of e.kpis!) {
        if (k.after === 'settlement' && !engine) continue;
        const ask = () => one<{ m: { total: { value: number | null }; read: Record<string, string> } }>(
          db, 'select kpis.measure($1, $2, $3, $4, $5) m', [kindOf(k.object), idOf(ids, k.object), k.indicator, s.period.from, s.period.to]);
        if (k.refusal) {
          expect(await refusal(ask), `${k.indicator} of ${k.object}`).toBe(k.refusal);
          continue;
        }
        const m = (await ask()).m;
        close(m.total.value, k.value!, k.tolerance!);
        if (k.read) expect(m.read, `${k.indicator} of ${k.object}`).toMatchObject(k.read);
      }
    });
  });
});
