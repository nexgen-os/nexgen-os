// The `kpis` module: indicators as data, computed for a participant and a
// project of Testland against the figures of `golden/community.json`,
// worked out by hand; written back as series and read like any; targets,
// a portfolio, an export template; and the evaluator that reads formulas,
// which knows numbers, variables and seven operators and nothing else.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';
import { compute as computeTs, indicatorsOf, measure, portfolio, report } from '../src/kpis.js';

const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'golden', 'community.json'), 'utf8'));
const { from: FROM, to: TO } = golden.period as { from: string; to: string };

let db: PGlite;
let org: string;
let project: string;
let prosumer: string;
let consumer: string;
let meter: string;
let device: string;

type Row = Record<string, unknown>;
const q = async <T = Row>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function storeAll(kind: string, id: string, quantity: string, points: [string, number][]) {
  await db.query(
    `select store(null, $1::timestamptz[], $2::float8[], null, null, null,
                  jsonb_build_object('object_kind', $3::text, 'object_id', $4::uuid, 'quantity_code', $5::text, 'step', '1 hour'))`,
    [points.map((p) => p[0]), points.map((p) => p[1]), kind, id, quantity],
  );
}

async function storeObject(kind: string, id: string, bySeries: Record<string, [string, number][]>) {
  for (const [quantity, points] of Object.entries(bySeries)) await storeAll(kind, id, quantity, points);
}

const compute = async (kind: string, id: string, indicator: string, from = FROM, to = TO, granularity: string | null = '1 month') =>
  (await one<{ id: string }>(db, 'select kpis.compute($1, $2, $3, $4, $5, $6::interval) id', [kind, id, indicator, from, to, granularity])).id;

const figure = async (id: string) =>
  one<{ results: { buckets: { at: string; value: number | null }[]; total: { value: number | null } }; inputs: Row; series_id: string; provenance: string }>(
    db, 'select results, inputs, series_id, provenance from kpis.figures where id = $1', [id]);

const evaluate = async (formula: string, values: Row = {}) =>
  (await one<{ v: number | null }>(
    db, 'select kpis.evaluate(kpis.compile($1, $2), $3) v',
    [formula, JSON.stringify(Object.fromEntries(Object.keys(values).map((k) => [k, {}]))), JSON.stringify(values)])).v;

const refusal = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
  } catch (e) {
    return (e as Error).message.split(':')[0];
  }
  return 'accepted';
};

beforeAll(async () => {
  db = await freshDatabase(['community', 'kpis', 'solar']);
  org = await organisation(db, 'A cooperative', USER_A);
  await organisation(db, 'Another cooperative', USER_B);
  const p = golden.parameters;
  // A pack: a country and its currency, its statistics office, what it decides.
  await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                  values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
  await db.query(`insert into sources (code, name, kind, base_url, published_by)
                  values ('zz_statistics', 'Testland statistics office', 'text', 'https://statistics.example/', 'pack:zz')`);
  for (const f of p.grid_co2_factor) {
    await db.query(`insert into defaults (attribute_type, country, value, valid_from, valid_to, source_code, published_by)
                    values ('grid_co2_factor', 'ZZ', $1, $2, $3, 'zz_statistics', 'pack:zz')`, [String(f.value), f.valid_from, f.valid_to ?? null]);
  }
  for (const code of ['energy_price_household', 'grid_fees_and_taxes', 'injection_price_reference']) {
    await db.query(`insert into defaults (attribute_type, country, value, source_code, published_by) values ($1, 'ZZ', $2, 'zz_statistics', 'pack:zz')`,
      [code, String(p[code])]);
  }
  await db.query(`insert into identifier_schemes (code, name, pattern) values ('zz_ean', 'Testland connection point', '^[0-9]+$')`);

  project = await insert(db, 'projects', { organisation_id: org, name: 'A shared roof', country: 'ZZ' });
  prosumer = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'The school', country: 'ZZ', time_zone: golden.time_zone });
  consumer = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'The library', country: 'ZZ', time_zone: golden.time_zone });
  meter = await insert(db, 'meters', { organisation_id: org, participant_id: prosumer, identifier: '1001', scheme: 'zz_ean' });
  device = await insert(db, 'devices', { organisation_id: org, participant_id: prosumer, name: 'Roof PV', device_type: 'solar' });
  await db.query(`select set_attribute('participant', $1, 'installed_power', $2::jsonb)`, [prosumer, String(p.installed_power_kw)]);

  const s = golden.series;
  await storeObject('meter', meter, s.prosumer.meter);
  await storeObject('device', device, s.prosumer.device);
  await storeObject('participant', prosumer, s.prosumer.participant);
  await storeObject('participant', consumer, s.consumer.participant);
});

afterAll(async () => {
  await db?.close();
});

describe('the evaluator', () => {
  it('reads numbers, variables, four operators, a unary minus, parentheses, min, max and abs', async () => {
    expect(await evaluate('2 + 3 * 4')).toBe(14);
    expect(await evaluate('(2 + 3) * 4')).toBe(20);
    expect(await evaluate('8 / 4 / 2')).toBe(1);
    expect(await evaluate('2 - 3 - 4')).toBe(-5);
    expect(await evaluate('-2 * 3')).toBe(-6);
    expect(await evaluate('2 - -3')).toBe(5);
    expect(await evaluate('1.5e3 / 1000')).toBe(1.5);
    expect(await evaluate('min(a, b) + max(a, b) * abs(c)', { a: 2, b: 5, c: -1 })).toBe(7);
    expect(await evaluate('a / (b - c)', { a: 1, b: 2, c: 2 })).toBeNull();
    expect(await evaluate('a + b', { a: 1, b: null })).toBeNull();
  });

  it('refuses anything else, by name, before it is stored', async () => {
    const compile = (f: string, vars = '{"a": {}}') => refusal('select kpis.compile($1, $2)', [f, vars]);
    expect(await compile('a; drop table kpis.figures')).toBe('formula_invalid');
    expect(await compile("a || 'x'")).toBe('formula_invalid');
    expect(await compile('exp(a)')).toBe('function_unknown');
    expect(await compile('a + b')).toBe('variable_unknown');
    expect(await compile('(a + 1')).toBe('formula_invalid');
    expect(await compile('a + 1)')).toBe('formula_invalid');
    expect(await compile('a +')).toBe('formula_invalid');
    expect(await compile('min(a)')).toBe('formula_invalid');
    expect(await compile('a a')).toBe('formula_invalid');
    const add = (variables: string, formula = 'a') => refusal(
      `insert into kpis.indicators (code, name, quantity_code, applies_to, formula, variables) values ('x', 'X', 'ratio', '{participant}', $1, $2)`,
      [formula, variables]);
    expect(await add('{"a": {"parameter": "no_such_parameter"}}')).toBe('attribute_type_unknown');
    expect(await add('{"a": {"quantity": "energy", "parameter": "installed_power"}}')).toBe('variable_invalid');
    expect(await add('{"a": {"quantity": "energy", "combine": "max"}}')).toBe('variable_invalid');
    expect(await add('{"min": {"quantity": "energy"}}', 'min')).toBe('variable_invalid');
  });

  it('keeps the program of every indicator it publishes', async () => {
    const rows = await q<{ code: string; program: string[] }>('select code, program from kpis.indicators order by code');
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.find((r) => r.code === 'self_consumption_rate')?.program).toEqual(['direct', 'charge', '+', 'production', '/']);
  });
});

describe('the indicators of a participant, month by month', () => {
  const expected = golden.expected.prosumer_by_month as Record<string, { months: number[]; total: number }>;

  it.each(Object.keys(expected))('%s is the figure worked out by hand', async (code) => {
    const f = await figure(await compute('participant', prosumer, code));
    expect(f.results.buckets.map((b) => b.at.slice(0, 10))).toEqual(['2026-01-01', '2026-02-01']);
    f.results.buckets.forEach((b, i) => expect(b.value).toBeCloseTo(expected[code].months[i], 9));
    expect(f.results.total.value).toBeCloseTo(expected[code].total, 9);
    expect(f.provenance).toBe('kpis-0.3.0');
  });

  it('says what it read: the series of each variable and every answer of parameter_of()', async () => {
    const f = await figure(await compute('participant', prosumer, 'co2_avoided'));
    const series = f.inputs.series as Record<string, string[]>;
    const production = await one<{ object_kind: string }>(db, 'select object_kind from series where id = $1', [series.production[0]]);
    expect(production.object_kind).toBe('device');
    const injection = await one<{ object_kind: string }>(db, 'select object_kind from series where id = $1', [series.injection[0]]);
    expect(injection.object_kind).toBe('meter');
    const factor = (f.inputs.parameters as Record<string, { value: number; level: string; source_code: string }[]>).factor;
    expect(factor.map((a) => [a.value, a.level, a.source_code])).toEqual([[0.2, 'country', 'zz_statistics'], [0.3, 'country', 'zz_statistics']]);
    expect((f.inputs.indicator as Row).formula).toBe('direct_co2 + discharge_co2');
    // No series measures the self-consumption nor a battery: computed from the balance, and said; no
    // carbon intensity series of the zone: the monthly factor, and said.
    expect(f.inputs.read).toMatchObject({ direct_co2: 'computed', discharge_co2: 'computed', charge_co2: 'computed', production_co2: 'computed',
      injection_co2: 'computed', production: 'measured', injection: 'measured' });
    expect(Object.keys(f.inputs.fallbacks as Row).sort()).toEqual(['injection_co2', 'production_co2']);
  });

  it('writes its buckets as a simulated series of the participant, read back by resample()', async () => {
    const id = await compute('participant', prosumer, 'self_consumption_rate');
    const f = await figure(id);
    const s = await one<Row>(db, 'select object_kind, object_id, quantity_code, kind, name, source, step::text from series where id = $1', [f.series_id]);
    expect(s).toEqual({ object_kind: 'participant', object_id: prosumer, quantity_code: 'ratio', kind: 'simulated',
      name: 'self_consumption_rate', source: `kpis.figures:${id}`, step: '1 mon' });
    const back = await q<{ value: number }>(`select value from resample($1, $2, $3, '1 month') order by bucket`, [f.series_id, FROM, TO]);
    expect(back.map((r) => r.value)).toEqual([0.75, 0.5]);
    // Computed again, it replaces its figure and keeps its series.
    expect(await compute('participant', prosumer, 'self_consumption_rate')).toBe(id);
    expect((await figure(id)).series_id).toBe(f.series_id);
  });

  it('compares a period with the same period a year before', async () => {
    const f = await figure(await compute('participant', prosumer, 'offtake_change_rate', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', null));
    expect(f.results.total.value).toBeCloseTo(golden.expected.prosumer_january_against_the_year_before.offtake_change_rate, 9);
  });

  it('refuses what it cannot compute, by name', async () => {
    const c = (kind: string, id: string, code: string, granularity: string | null = '1 month', from = FROM) =>
      refusal('select kpis.compute($1, $2, $3, $4, $5, $6::interval)', [kind, id, code, from, TO, granularity]);
    expect(await c('participant', prosumer, 'no_such_indicator')).toBe('indicator_unknown');
    expect(await c('device', device, 'self_consumption_rate')).toBe('indicator_not_applicable');
    expect(await c('participant', prosumer, 'self_consumption_rate', '1 month', TO)).toBe('period_invalid');
    expect(await c('participant', consumer, 'self_consumption_rate')).toBe('series_not_found');
    expect(await c('participant', consumer, 'specific_yield')).toBe('series_not_found');
    const lost = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'A kiosk', country: 'ZZ' });
    await storeAll('participant', lost, 'production_energy', [['2026-01-31T10:00:00Z', 1]]);
    await storeAll('participant', lost, 'injection_energy', [['2026-01-31T10:00:00Z', 1]]);
    expect(await c('participant', lost, 'self_consumption_rate')).toBe('time_zone_required');
    await db.query('delete from participants where id = $1', [lost]);
    await db.query(`insert into kpis.indicators (code, name, quantity_code, applies_to, formula, variables)
                    values ('wind_rate', 'Wind', 'ratio', '{participant}', 'w', '{"w": {"quantity": "no_such_quantity"}}')`);
    expect(await c('participant', prosumer, 'wind_rate')).toBe('quantity_unknown');
  });

  it('is computed and read by the members of its organisation only', async () => {
    await asUser(db, USER_A, () => compute('participant', prosumer, 'self_sufficiency_rate'));
    expect(await asUser(db, USER_B, () => refusal(`select kpis.compute('participant', $1, 'self_sufficiency_rate', $2, $3, '1 month')`, [prosumer, FROM, TO])))
      .toBe('object_not_found');
    expect(await asUser(db, USER_B, () => q('select * from kpis.figures'))).toEqual([]);
    expect(await asUser(db, USER_B, () => q(`select * from kpis.of('participant', $1, $2, $3)`, [prosumer, FROM, TO]))).toEqual([]);
  });
});

describe('the indicators of a project', () => {
  const expected = golden.expected.project_over_the_period as Record<string, { value: number }>;

  it.each(Object.keys(expected))('%s adds up its participants', async (code) => {
    const f = await figure(await compute('project', project, code, FROM, TO, null));
    expect(f.results.total.value).toBeCloseTo(expected[code].value, 9);
  });

  it('takes the peak of the hour all its participants share', async () => {
    const e = golden.expected.project_peak_by_month;
    const f = await figure(await compute('project', project, 'peak_offtake_power'));
    expect(f.results.buckets.map((b) => b.value)).toEqual(e.months);
    expect(f.results.total.value).toBe(e.total);
  });
});

describe('targets, a portfolio, a report', () => {
  it('says whether a figure meets the target of its period', async () => {
    await db.query(`insert into kpis.targets (object_kind, object_id, indicator_code, valid_from, valid_to, value, source)
                    values ('participant', $1, 'self_consumption_rate', '2026-01-01', '2027-01-01', 0.7, 'the board, 2025'),
                           ('participant', $1, 'peak_offtake_power', null, null, 4, 'the subscribed power')`, [prosumer]);
    await compute('participant', prosumer, 'self_consumption_rate');
    await compute('participant', prosumer, 'peak_offtake_power');
    const rows = await asUser(db, USER_A, () =>
      q<Row>(`select indicator_code, value, target, met from kpis.of('participant', $1, $2, $3) where granularity = '1 month'
               and indicator_code in ('self_consumption_rate', 'peak_offtake_power') order by 1`, [prosumer, FROM, TO]));
    expect(rows).toEqual([
      { indicator_code: 'peak_offtake_power', value: 3, target: 4, met: true },
      { indicator_code: 'self_consumption_rate', value: 0.6, target: 0.7, met: false },
    ]);
  });

  it('aggregates the projects the caller may read, without a table', async () => {
    const other = await insert(db, 'projects', { organisation_id: org, name: 'A second roof', country: 'ZZ' });
    const farm = await insert(db, 'participants', { organisation_id: org, project_id: other, name: 'The farm', country: 'ZZ', time_zone: 'UTC' });
    await storeObject('participant', farm, {
      production_energy: [['2026-02-01T12:00:00Z', 10]], injection_energy: [['2026-02-01T12:00:00Z', 5]], offtake_energy: [['2026-02-01T12:00:00Z', 5]],
    });
    const empty = await insert(db, 'projects', { organisation_id: org, name: 'A study', country: 'ZZ' });
    // A project of another organisation, with the same figures, which the caller does not read.
    const theirs = await one<{ id: string }>(db, `select id from organisations where name = 'Another cooperative'`);
    const theirProject = await insert(db, 'projects', { organisation_id: theirs.id, name: 'Their roof', country: 'ZZ' });
    const theirFarm = await insert(db, 'participants', { organisation_id: theirs.id, project_id: theirProject, name: 'Their farm', country: 'ZZ', time_zone: 'UTC' });
    await storeObject('participant', theirFarm, { production_energy: [['2026-02-01T12:00:00Z', 100]], injection_energy: [['2026-02-01T12:00:00Z', 0]] });

    for (const [code, e] of Object.entries(golden.expected.portfolio as Record<string, { value: number; projects: number }>)) {
      const rows = await asUser(db, USER_A, () =>
        q<{ currency: string | null; projects: number; value: number; skipped: { project_id: string; refusal: string }[] }>(
          'select * from kpis.portfolio($1, $2, $3)', [code, FROM, TO]));
      expect(rows).toHaveLength(1);
      expect(rows[0].projects).toBe(e.projects);
      expect(rows[0].value).toBeCloseTo(e.value, 9);
      expect(rows[0].skipped.map((s) => [s.project_id, s.refusal.split(':')[0]])).toEqual([[empty, 'series_not_found']]);
    }
  });

  it('adds amounts of money by currency, each project reading its own prices, else its country\'s', async () => {
    await db.query(`select set_attribute('project', $1, 'energy_price_household', '100'), set_attribute('project', $1, 'grid_fees_and_taxes', '50')`, [project]);
    const rows = await asUser(db, USER_A, () =>
      q<{ currency: string; projects: number; value: number }>(`select currency, projects, value from kpis.portfolio('self_consumption_savings_household', $1, $2)`, [FROM, TO]));
    // The shared roof at its own prices (0.9), the second roof at the
    // defaults of its country, which parameter_of() reaches for a project:
    // 5 kWh self-consumed at 100 + 50 per MWh.
    expect(rows.map((r) => [r.currency, r.projects])).toEqual([['ZZZ', 2]]);
    expect(rows[0].value).toBeCloseTo(0.9 + 0.75, 9);
    const second = await one<{ p: { level: string; country: string } }>(db,
      `select parameter_of('project', id, 'energy_price_household') p from projects where name = 'A second roof'`);
    expect(second.p).toMatchObject({ level: 'country', country: 'ZZ' });
  });

  it('reads a template back from the figures computed, an empty cell where there is none', async () => {
    const rows = await asUser(db, USER_A, () =>
      q<{ sheet: string; section: string; position: number; indicator_code: string; value: number | null; status: string }>(
        `select sheet, section, position, indicator_code, value, status from kpis.report('pv_performance', 'participant', $1, $2, $3)`,
        [prosumer, FROM, TO]));
    expect(rows.map((r) => r.indicator_code)).toEqual(['specific_yield', 'performance_ratio', 'self_consumption_rate', 'self_sufficiency_rate']);
    expect(rows.every((r) => r.status === 'computed')).toBe(true);
    expect(rows[2].value).toBeCloseTo(0.6, 9);
    const community = await asUser(db, USER_A, () =>
      q<{ indicator_code: string; value: number | null; status: string }>(
        `select indicator_code, value, status from kpis.report('energy_community_report', 'project', $1, $2, $3)`, [project, FROM, TO]));
    const residual = community.find((r) => r.indicator_code === 'residual_offtake_energy');
    // Computed over the period, not by month: the monthly report has no figure for it.
    expect(residual).toEqual({ indicator_code: 'residual_offtake_energy', value: null, status: 'not_computed' });
    expect(community.find((r) => r.indicator_code === 'peak_offtake_power')?.value).toBe(5);
    expect(await refusal(`insert into kpis.templates (code, name, layout) values ('t', 'T', '{"sheets": [{"name": "S", "sections": [{"name": "A", "indicators": ["nothing"]}]}]}')`))
      .toBe('indicator_unknown');
  });
});

describe('from TypeScript', () => {
  it('calls the same functions, and finds the same figures', async () => {
    const m = await measure(db, 'participant', prosumer, 'coverage_rate', { from: FROM, to: TO, granularity: '1 month' });
    expect(m.buckets.map((b) => b.value)).toEqual([4 / 6, 1]);
    expect(m.total.variables).toEqual({ production: 10, injection: 4, offtake: 6, direct: 6, charge: 0, discharge: 0 });
    const id = await computeTs(db, 'participant', prosumer, 'coverage_rate', { from: FROM, to: TO, granularity: '1 month' });
    const of = (await indicatorsOf(db, 'participant', prosumer, FROM, TO)).find((r) => r.indicator_code === 'coverage_rate');
    expect(of?.figure_id).toBe(id);
    expect(of?.value).toBeCloseTo(10 / 12, 9);
    expect(of?.display_unit).toBe('PERCENT');
    expect((await asUser(db, USER_A, () => portfolio(db, 'self_consumed_energy', FROM, TO)))[0].projects).toBe(2);
    const rows = await report(db, 'pv_performance', 'participant', prosumer, FROM, TO);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });
});

describe('on the full core: self-consumption measured or computed, batteries, prices of an interval', () => {
  const DAY = ['2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z'] as const;
  const h = (i: number) => `2026-01-10T1${i}:00:00Z`;
  let home: string;
  let inverter: string;
  let site: string;

  beforeAll(async () => {
    site = await insert(db, 'projects', { organisation_id: org, name: 'A house with a battery', country: 'ZZ' });
    home = await insert(db, 'participants', { organisation_id: org, project_id: site, name: 'The house', country: 'ZZ', time_zone: 'UTC' });
    const m = await insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: '2002', scheme: 'zz_ean' });
    inverter = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar' });
    const battery = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Battery', device_type: 'battery' });
    await storeObject('device', inverter, { production_energy: [[h(0), 4], [h(1), 2]] });
    await storeObject('meter', m, { injection_energy: [[h(0), 1], [h(1), 0]], offtake_energy: [[h(0), 0], [h(1), 3]] });
    await storeObject('device', battery, { battery_charge_energy: [[h(0), 1], [h(1), 0]], battery_discharge_energy: [[h(0), 0], [h(1), 1]] });
  });

  const day = async (code: string, kind = 'participant', id = home) =>
    figure(await compute(kind, id, code, DAY[0], DAY[1], null));

  it('reads the batteries in the balance: what they stored is not injected, what they gave back is consumed on the spot', async () => {
    // direct = production − injection − charge = 4 − 1 − 1 + 2 − 0 − 0 = 4; with the discharge, 5 of 6 produced, 5 of 8 consumed.
    expect((await day('self_consumed_energy')).results.total.value).toBeCloseTo(5, 9);
    expect((await day('self_consumption_rate')).results.total.value).toBeCloseTo(5 / 6, 9);
    expect((await day('self_sufficiency_rate')).results.total.value).toBeCloseTo(5 / 8, 9);
    expect((await day('battery_charged_energy')).results.total.value).toBeCloseTo(1, 9);
    expect((await day('battery_discharged_energy')).results.total.value).toBeCloseTo(1, 9);
    expect((await day('battery_boost_rate')).results.total.value).toBeCloseTo(1 / 6, 9);
    // For the project, every battery of its participants: the boost of its collective self-consumption.
    expect((await day('battery_boost_rate', 'project', site)).results.total.value).toBeCloseTo(1 / 6, 9);
    expect((await day('self_consumed_energy')).inputs.read).toMatchObject({ direct: 'computed', charge: 'measured', discharge: 'measured' });
  });

  it('reads the self-consumption a series measures before computing it, and says which', async () => {
    await storeObject('device', inverter, { self_consumption_energy: [[h(0), 3], [h(1), 1.5]] });
    const f = await day('self_consumed_energy');
    expect(f.results.total.value).toBeCloseTo(4.5 + 1, 9);
    expect(f.inputs.read).toEqual({ direct: 'measured', discharge: 'measured' });
    // Production and injection are not read when nothing needs them.
    expect(Object.keys(f.inputs.series as Row).sort()).toEqual(['direct', 'discharge']);
  });

  it('weights an energy by the price of each hour, the nearest price series of the object, and refuses without one', async () => {
    expect(await refusal(`select kpis.measure('participant', $1, 'injection_day_ahead_value', $2, $3)`, [home, ...DAY])).toBe('prices_required');
    await storeObject('project', site, { energy_price: [[h(0), 50], [h(1), 200]] });
    const f = await day('injection_day_ahead_value');
    // 1 kWh at 50 per MWh, 0 kWh at 200.
    expect(f.results.total.value).toBeCloseTo(0.05, 9);
    expect((f.inputs.prices as Record<string, { kind: string }>).injection.kind).toBe('measured');
    const s = await one<{ quantity_code: string; currency: string }>(db, 'select quantity_code, currency from series s join kpis.figures f on f.series_id = s.id where f.id = (select id from kpis.figures where object_id = $1 and indicator_code = $2)', [home, 'injection_day_ahead_value']);
    expect(s).toEqual({ quantity_code: 'amount', currency: 'ZZZ' });
  });

  it('refuses an otherwise formula that is not one, and two that read each other', async () => {
    const add = (variables: string, formula = 'a') => refusal(
      `insert into kpis.indicators (code, name, quantity_code, applies_to, formula, variables) values ('x_rate', 'X', 'ratio', '{participant}', $1, $2)`,
      [formula, variables]);
    expect(await add('{"a": {"quantity": "energy", "otherwise": "b"}, "b": {"quantity": "energy", "otherwise": "a"}}')).toBe('variable_invalid');
    expect(await add('{"a": {"parameter": "installed_power", "otherwise": "1"}}')).toBe('variable_invalid');
    expect(await add('{"a": {"quantity": "energy", "otherwise": "c"}}')).toBe('variable_unknown');
    expect(await add('{"a": {"quantity": "energy", "times": "energy_price"}}')).toBe('variable_invalid');
  });
});

describe('emission factors, hour by hour or month by month', () => {
  it('reads the carbon intensity series of the bidding zone hour by hour when the organisation holds one, the monthly factor otherwise, and says which', async () => {
    await db.query(`insert into defaults (attribute_type, country, value, source_code, published_by) values ('bidding_zone', 'ZZ', '"10YZZ----------1"', 'zz_statistics', 'pack:zz')`);
    const monthly = await figure(await compute('participant', prosumer, 'co2_avoided'));
    expect(monthly.results.buckets.map((b) => b.value)).toEqual([expect.closeTo(0.6, 9), expect.closeTo(0.9, 9)]);
    expect((monthly.inputs.fallbacks as Row).production_co2).toEqual({ without: 'emission_factor', formula: 'production * factor' });

    // A carbon intensity series of another zone is not read.
    const hours = ['2026-01-31T10:00:00Z', '2026-01-31T20:00:00Z', '2026-02-01T12:00:00Z', '2026-02-01T19:00:00Z'];
    const intensity = async (zone: string, values: number[]) => {
      const id = (await one<{ id: string }>(db, `select series_ensure('organisation', $1, 'emission_factor', 'measured', 'interval', '1 hour', null, null, 'zz_statistics', 'Grid carbon intensity of ' || $2) id`,
        [org, zone])).id;
      await db.query('select store($1, $2::timestamptz[], $3::float8[])', [id, hours, values]);
      await db.query(`select set_attribute('series', $1, 'bidding_zone', to_jsonb($2::text), null, 'zz_statistics', 'the zone of the series', 'published')`, [id, zone]);
      return id;
    };
    await intensity('10YZZ----------9', [9, 9, 9, 9]);
    expect(Object.keys((await figure(await compute('participant', prosumer, 'co2_avoided'))).inputs.fallbacks as Row)).toHaveLength(2);

    const ours = await intensity('10YZZ----------1', [0.1, 0.2, 0.5, 0.4]);
    const hourly = await figure(await compute('participant', prosumer, 'co2_avoided'));
    // (4 − 1) kWh at 0.1 on 31 January, (6 − 3) kWh at 0.5 on 1 February.
    expect(hourly.results.buckets.map((b) => b.value)).toEqual([expect.closeTo(0.3, 9), expect.closeTo(1.5, 9)]);
    expect(hourly.inputs.fallbacks).toEqual({});
    expect((hourly.inputs.prices as Record<string, Row>).production_co2).toMatchObject({ quantity: 'emission_factor', series: [ours] });

    // Scope 2, location-based: 3 kWh at 0.2; then 1 kWh at 0.5 and 2 kWh at 0.4.
    const location = await figure(await compute('participant', prosumer, 'scope2_location_based'));
    expect(location.results.buckets.map((b) => b.value)).toEqual([expect.closeTo(0.6, 9), expect.closeTo(1.3, 9)]);
  });

  it('reads the market-based factor of the supply contract when the participant has one, the residual mix of the country otherwise', async () => {
    await db.query(`insert into defaults (attribute_type, country, value, source_code, reference, published_by) values ('market_co2_factor', 'ZZ', '0.45', 'zz_statistics', 'residual mix 2025', 'pack:zz')`);
    await db.query(`select set_attribute('participant', $1, 'market_co2_factor', '0.05', '2026-02-01', null, 'supplier disclosure 2025', 'published')`, [prosumer]);
    const market = await figure(await compute('participant', prosumer, 'scope2_market_based'));
    expect(market.results.buckets.map((b) => b.value)).toEqual([expect.closeTo(1.35, 9), expect.closeTo(0.15, 9)]);
    const factor = (market.inputs.parameters as Record<string, { level: string; reference: string; quality: string }[]>).factor;
    expect(factor.map((a) => [a.level, a.reference, a.quality])).toEqual([['country', 'residual mix 2025', 'published'], ['object', 'supplier disclosure 2025', 'published']]);
  });
});

describe('a peak at the step the meters keep', () => {
  const DAY = ['2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z'] as const;
  const at = (minutes: number) => new Date(Date.parse(DAY[0]) + minutes * 60_000).toISOString();
  // 96 quarter-hours of 0.25 kWh, 1 kW, but 2.5 kWh at 18:45: 10 kW for 15 minutes, an hour of 3.25 kWh.
  const quarters: [string, number][] = Array.from({ length: 96 }, (_, i) => [at(i * 15), i === 18 * 4 + 3 ? 2.5 : 0.25]);
  const hours: [string, number][] = Array.from({ length: 24 }, (_, h) => [at(h * 60), quarters.slice(h * 4, h * 4 + 4).reduce((a, x) => a + x[1], 0)]);
  let site: string;
  let shop: string;
  let office: string;
  let kiosk: string;

  const storeStep = (id: string, points: [string, number][], step: string | null) => db.query(
    `select store(null, $1::timestamptz[], $2::float8[], null, null, null,
                  jsonb_build_object('object_kind', 'participant', 'object_id', $3::uuid, 'quantity_code', 'offtake_energy', 'step', $4::text))`,
    [points.map((p) => p[0]), points.map((p) => p[1]), id, step]);
  const peak = async (kind: string, id: string) =>
    (await one<{ m: { total: { value: number }; steps: Record<string, string> } }>(db,
      `select kpis.measure($1, $2, 'peak_offtake_power', $3, $4) m`, [kind, id, ...DAY])).m;

  beforeAll(async () => {
    site = await insert(db, 'projects', { organisation_id: org, name: 'A row of shops', country: 'ZZ' });
    shop = await insert(db, 'participants', { organisation_id: org, project_id: site, name: 'The bakery', country: 'ZZ', time_zone: 'UTC' });
    office = await insert(db, 'participants', { organisation_id: org, project_id: site, name: 'The office', country: 'ZZ', time_zone: 'UTC' });
    const corner = await insert(db, 'projects', { organisation_id: org, name: 'A corner kiosk', country: 'ZZ' });
    kiosk = await insert(db, 'participants', { organisation_id: org, project_id: corner, name: 'The kiosk', country: 'ZZ', time_zone: 'UTC' });
    await storeStep(shop, quarters, '15 minutes');
    await storeStep(office, hours, '1 hour');
    // An irregular series, its step not given: the quarter-hours its readings are apart.
    await storeStep(kiosk, quarters, null);
  });

  it('reads a meter kept by quarter-hours by quarter-hours: the 10 kW a capacity tariff reads', async () => {
    const m = await peak('participant', shop);
    expect(m.total.value).toBeCloseTo(10, 9);
    expect(m.steps).toEqual({ offtake: '00:15:00' });
  });

  it('reads an hourly series by hours, never finer: 3.25 kW, not 13', async () => {
    const m = await peak('participant', office);
    expect(m.total.value).toBeCloseTo(3.25, 9);
    expect(m.steps).toEqual({ offtake: '01:00:00' });
  });

  it('finds the step of an irregular series from its readings', async () => {
    expect((await peak('participant', kiosk)).total.value).toBeCloseTo(10, 9);
  });

  it('reads a project at the coarsest step of its participants, the same hour for all', async () => {
    const m = await peak('project', site);
    expect(m.total.value).toBeCloseTo(3.25 + 3.25, 9);
    expect(m.steps).toEqual({ offtake: '01:00:00' });
  });

  it('keeps the step it read in the figure', async () => {
    const f = await figure(await compute('participant', shop, 'peak_offtake_power', DAY[0], DAY[1], '1 day'));
    expect(f.results.total.value).toBeCloseTo(10, 9);
    expect(f.inputs.steps).toEqual({ offtake: '00:15:00' });
  });

  it('refuses an amount per a duration without a step, or over a day', async () => {
    const add = (variables: string) => refusal(
      `insert into kpis.indicators (code, name, quantity_code, applies_to, formula, variables) values ('p_power', 'P', 'power', '{participant}', 'a', $1)`, [variables]);
    expect(await add('{"a": {"quantity": "offtake_energy", "per": "1 hour", "combine": "max"}}')).toBe('variable_invalid');
    expect(await add('{"a": {"quantity": "offtake_energy", "step": "15 minutes", "per": "1 day", "combine": "max"}}')).toBe('variable_invalid');
  });
});
