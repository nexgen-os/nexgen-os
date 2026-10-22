// The pvlib engine (packages/connectors/pvlib), when it is installed: the same roof
// computed by modules/solar/src/pvwatts.ts and by pvlib with the same model
// choices, day by day; pvlib's own transposition against the source's; its
// named refusals; and a yield estimate through it. Without the engine, every test
// is skipped and says how to install it.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { CollectedSeries, SeriesPoint } from '@nexgen-os/core';
import { openMeteo } from '@nexgen-os/open-meteo';
import { hourStart } from '@nexgen-os/pvgis';
import { PVLIB_ENGINE, type PvYieldRequest, type PvYieldResult } from '@nexgen-os/core';
import { describeEngine, runEngine, type EngineSpec } from '@nexgen-os/core';
import { sandiaFromOnd } from '../modules/solar/src/inverter.js';
import { alignWeather, arrayEnergy, cleanWeather, remainingAfterLosses } from '../modules/solar/src/pvwatts.js';
import { estimateYield } from '../modules/solar/src/yield.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot, participant } from './helpers/db.js';
import { answering, fixture, syntheticArchive } from './helpers/weather.js';

// The caller gives the command: the environment's, else the local virtual environment, else the Python on the path.
const localVenv = `${repoRoot}/.venv-pvlib/bin/python`;
const spec: EngineSpec = {
  ...PVLIB_ENGINE,
  command: process.env.NEXGEN_ENGINE_PVLIB ? undefined : [existsSync(localVenv) ? localVenv : 'python3', '-m', 'nexgen_pvlib'],
};
const installed = await describeEngine(spec).catch(() => null);
const skipped = installed ? '' : ` (skipped: the pvlib engine is not installed; ${PVLIB_ENGINE.install})`;

// The system of modules/solar/tests/pvwatts.test.ts: 1 kWp facing south on a ventilated roof, Faiman 25 / 6.84, γ −0.35 %/K, 14 % losses.
const KWP = 1;
const GAMMA = -0.0035;
const FAIMAN = { u0: 25, u1: 6.84 };
const LOSSES = [{ code: 'system', pct: 14 }];
const SITE = { lat: 50.85, lon: 4.35, altitude_m: 30, time_zone: 'Europe/Brussels' };

const request = (weather: CollectedSeries[], over: Partial<PvYieldRequest> & { tilt?: number } = {}): PvYieldRequest => ({
  kind: 'pv_yield',
  site: SITE,
  arrays: [{ name: 'South', azimuth_deg: 180, tilt_deg: over.tilt ?? 35, mounting: 'roof_parallel', module: { model: 'pvwatts', parameters: { pdc0: KWP * 1000, gamma_pdc: GAMMA } } }],
  inverter: { model: 'no_loss' },
  losses: LOSSES.map((l) => ({ code: l.code, fraction: l.pct / 100 })),
  models: { transposition: 'haydavies', temperature: 'faiman', temperature_parameters: FAIMAN, aoi: 'no_loss', spectral: 'no_loss' },
  weather,
  ...over,
});

/** Daily totals by UTC day (both fixtures are winter days in Brussels: nights at both ends). */
const daily = (points: SeriesPoint[]) => {
  const days = new Map<string, number>();
  for (const p of points) days.set(p.at.slice(0, 10), (days.get(p.at.slice(0, 10)) ?? 0) + p.value);
  return [...days.entries()].sort();
};

/** modules/solar/src/pvwatts.ts on the same weather. */
const typescriptModel = (poa: SeriesPoint[], temperature: SeriesPoint[], wind: SeriesPoint[]) =>
  arrayEnergy(cleanWeather(alignWeather(poa, temperature, wind)).hours, { kwp: KWP, gammaPdc: GAMMA }, { ...FAIMAN, remainingFraction: remainingAfterLosses(LOSSES) });

const energyOf = (result: PvYieldResult) => result.series.find((s) => s.quantity_code === 'production_energy')!.values;
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(2)} %`;

// The PVGIS seriescalc recording: 48 h of plane-of-array irradiance (SARAH3), air temperature and wind at 10 m, Brussels, 1–2 January 2023, 180° / 35°.
const pvgisWeather = async (): Promise<CollectedSeries[]> => {
  const rows = (await fixture('pvgis-seriescalc-brussels-2023-48h.json')).outputs.hourly as { time: string; 'G(i)': number; T2m: number; WS10m: number }[];
  const of = (quantity_code: string, value_kind: 'interval' | 'instant', read: (r: (typeof rows)[number]) => number): CollectedSeries => ({ quantity_code, value_kind, step: '1 hour', values: rows.map((r) => ({ at: hourStart(r.time), value: read(r) })) });
  return [of('poa_irradiance', 'interval', (r) => r['G(i)']), of('temperature', 'instant', (r) => r.T2m), of('wind_speed', 'instant', (r) => r.WS10m)];
};

describe(`the pvlib engine${installed ? ` (${installed.version}, Python ${installed.dependencies.python})` : ''}`, () => {
  it.skipIf(!installed)(`describes itself: pvlib's version, its dependencies, the pv_yield kind${skipped}`, () => {
    expect(installed!.version).toMatch(/^pvlib \d+\.\d+/);
    expect(Object.keys(installed!.dependencies)).toEqual(expect.arrayContaining(['nexgen_pvlib', 'python', 'pvlib', 'pandas', 'numpy']));
    expect(installed!.kinds).toEqual(['pv_yield']);
  });

  it.skipIf(!installed)(`gives the daily energy of pvwatts.ts within 3 % with the same choices: PVGIS irradiance on the plane, Faiman, PVWatts DC, 14 %, no inverter${skipped}`, async () => {
    const weather = await pvgisWeather();
    const answer = await runEngine<PvYieldRequest, PvYieldResult>(spec, request(weather, { models: { temperature: 'faiman', temperature_parameters: FAIMAN, aoi: 'no_loss', spectral: 'no_loss' } }));
    const ts = daily(typescriptModel(weather[0].values, weather[1].values, weather[2].values));
    const py = daily(energyOf(answer.result));
    expect(py.map(([d]) => d)).toEqual(['2023-01-01', '2023-01-02']);
    for (const [i, [day, kwh]] of ts.entries()) {
      const message = `${day}: pvwatts.ts ${kwh.toFixed(4)} kWh, pvlib ${py[i][1].toFixed(4)} kWh (${pct(py[i][1], kwh)})`;
      console.info(`same choices — ${message}`);
      expect(Math.abs(py[i][1] - kwh) / kwh, message).toBeLessThan(0.03);
    }
    expect(answer.result.meta).toMatchObject({ models: { dc: 'pvwatts', ac: 'no_loss', aoi: 'no_loss', transposition: 'none: plane-of-array irradiance given', losses: { remaining_fraction: 0.86 } } });
  });

  it.skipIf(!installed)(`with the PVWatts inverter (96 % nominal) and the physical incidence model, says how much each adds${skipped}`, async () => {
    const weather = await pvgisWeather();
    const ts = daily(typescriptModel(weather[0].values, weather[1].values, weather[2].values));
    const inverter = await runEngine<PvYieldRequest, PvYieldResult>(spec, request(weather, { inverter: { model: 'pvwatts', parameters: { pdc0: 1000, eta_inv_nom: 0.96 } } }));
    const py = daily(energyOf(inverter.result));
    const gaps = ts.map(([day, kwh], i) => {
      console.info(`PVWatts inverter — ${day}: pvwatts.ts ${kwh.toFixed(4)} kWh, pvlib ${py[i][1].toFixed(4)} kWh (${pct(py[i][1], kwh)})`);
      return (py[i][1] - kwh) / kwh;
    });
    // pvwatts.ts models no inverter. The PVWatts inverter loses about 4 % near its rating and more at
    // low load: the overcast second day, at a tenth of the rating, loses more than the first.
    for (const gap of gaps) expect(gap).toBeLessThan(-0.03);
    expect(gaps[1]).toBeLessThan(gaps[0]);
    // Incidence needs the beam on the plane, which the plane-of-array total does not give.
    await expect(runEngine(spec, request(weather, { models: { temperature: 'faiman', temperature_parameters: FAIMAN, aoi: 'physical', spectral: 'no_loss' } }))).rejects.toThrow(/^weather_incomplete: aoi model physical needs the beam/);
  });

  it.skipIf(!installed)(`with the Sandia model fitted on an OND file's curves, loses what the curves say${skipped}`, async () => {
    const weather = await pvgisWeather();
    const ond = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/ond-inverter-10kw.json`, 'utf8'));
    // 23 modules of 430 W (PVsyst one-diode model) on the 11 kW inverter of the fixture, against the same array without an inverter:
    // Sandia reads the DC voltage, which only a one-diode or Sandia module model gives.
    const module = { gamma_ref: 1, mu_gamma: -0.0002, I_L_ref: 13.90531675, I_o_ref: 9.1907963e-12, R_sh_ref: 400, R_sh_0: 1600, R_sh_exp: 5.5, R_s: 0.153, alpha_sc: 0.00695, cells_in_series: 54, EgRef: 1.121 };
    const arrays: PvYieldRequest['arrays'] = [{ name: 'South', azimuth_deg: 180, tilt_deg: 35, mounting: 'roof_parallel', module: { model: 'pvsyst', parameters: module }, modules_per_string: 23, strings: 1 }];
    const dc = daily(energyOf((await runEngine<PvYieldRequest, PvYieldResult>(spec, request(weather, { arrays }))).result));
    const ac = daily(energyOf((await runEngine<PvYieldRequest, PvYieldResult>(spec, request(weather, { arrays, inverter: { model: 'sandia', parameters: { ...sandiaFromOnd(ond) } } }))).result));
    const gaps = dc.map(([day, kwh], i) => {
      console.info(`OND inverter (Sandia fit) — ${day}: no inverter ${kwh.toFixed(3)} kWh, Sandia ${ac[i][1].toFixed(3)} kWh (${pct(ac[i][1], kwh)})`);
      return (ac[i][1] - kwh) / kwh;
    });
    // The curves give 97–98 % near the rating and less at low load, the night draw on top.
    for (const gap of gaps) {
      expect(gap).toBeLessThan(-0.015);
      expect(gap).toBeGreaterThan(-0.1);
    }
  });

  it.skipIf(!installed)(`transposes the ERA5 horizontal components with Hay-Davies, against Open-Meteo's own plane-of-array irradiance${skipped}`, async () => {
    const where = { lon: 4.35, lat: 50.85 };
    const horizontal = await openMeteo({ fetch: answering(await fixture('open-meteo-era5-brussels-2023-01-01-03-horizontal.json')) }).history!(where, '2023-01-01', '2023-01-02', { quantities: ['ghi', 'dni', 'dhi', 'temperature', 'wind_speed'], model: 'era5' });
    const plane = await openMeteo({ fetch: answering(await fixture('open-meteo-era5-brussels-2023-01-01-03-south30.json')) }).history!(where, '2023-01-01', '2023-01-02', { tilt_deg: 30, azimuth_deg: 180, model: 'era5' });
    const ts = daily(typescriptModel(plane[0].values, plane[1].values, plane[2].values));
    const answer = await runEngine<PvYieldRequest, PvYieldResult>(spec, request(horizontal, { tilt: 30 }));
    const py = daily(energyOf(answer.result));
    for (const [i, [day, kwh]] of ts.entries()) {
      const message = `${day}: pvwatts.ts on Open-Meteo's tilted irradiance ${kwh.toFixed(4)} kWh, pvlib Hay-Davies ${py[i][1].toFixed(4)} kWh (${pct(py[i][1], kwh)})`;
      console.info(`transposition — ${message}`);
      // Two transpositions of the same sky: within 15 % on a winter day, where the diffuse part dominates.
      expect(Math.abs(py[i][1] - kwh) / kwh, message).toBeLessThan(0.15);
    }
    expect(answer.result.meta).toMatchObject({ models: { transposition: 'haydavies', decomposition: 'none: dni and dhi given' } });

    // GHI alone: Erbs gives the direct and the diffuse parts, and the meta says so.
    const ghiOnly = await runEngine<PvYieldRequest, PvYieldResult>(spec, request(horizontal.filter((s) => !['dni', 'dhi'].includes(s.quantity_code)), { tilt: 30 }));
    expect(ghiOnly.result.meta).toMatchObject({ models: { decomposition: 'erbs: dni and dhi derived from ghi' } });
    expect(daily(energyOf(ghiOnly.result))[0][1]).toBeGreaterThan(0);
  });

  it.skipIf(!installed)(`refuses by name: weather without temperature, a tracker, an unknown model, a loss without value${skipped}`, async () => {
    const weather = await pvgisWeather();
    await expect(runEngine(spec, request(weather.filter((s) => s.quantity_code !== 'temperature')))).rejects.toThrow(/^weather_incomplete: no air temperature/);
    const tracker = request(weather);
    (tracker.arrays[0] as { mounting: string }).mounting = 'tracker';
    await expect(runEngine(spec, tracker)).rejects.toThrow(/^array_invalid: South: trackers are not covered/);
    await expect(runEngine(spec, request(weather, { models: { temperature: 'delta_t', aoi: 'no_loss', spectral: 'no_loss' } }))).rejects.toThrow(/^model_unknown: temperature model 'delta_t'/);
    await expect(runEngine(spec, request(weather, { losses: [{ code: 'soiling', fraction: null }] }))).rejects.toThrow(/^loss_without_value: soiling/);
  });
});

describe('a yield estimate computed by pvlib', () => {
  let db: PGlite;
  let system: string;

  beforeAll(async () => {
    if (!installed) return;
    db = await freshDatabase(['solar']);
    const org = await organisation(db, 'A cooperative', USER_A);
    const home = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
    system = await insert(db, 'devices', { organisation_id: org, participant_id: home, name: 'Roof PV', device_type: 'solar', rated_power_kw: 20 });
    await db.query('insert into solar.devices (id, kwp_dc) values ($1, 20)', [system]);
    await db.query(`insert into solar.pv_arrays (organisation_id, device_id, azimuth_deg, tilt_deg, name, mounting, kwp_dc) values ($1, $2, 180, 30, 'South', 'roof_parallel', 20)`, [org, system]);
  });

  afterAll(async () => {
    await db?.close();
  });

  it.skipIf(!installed)(`the pvwatts profile through pvlib gives the annual of the pvwatts estimate on the same year, and records pvlib's version${skipped}`, async () => {
    const weather = () => ({ weather: openMeteo({ fetch: syntheticArchive(4.35, []) }) });
    const viaPvlib = await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: GAMMA, engine: spec }, weather());
    const here = await estimateYield(db, { deviceId: system, years: { from: 2023, to: 2023 }, profileCode: 'pvwatts', gammaPdc: GAMMA, typicalYear: false }, weather());
    console.info(`a synthetic year, 20 kWp: pvwatts.ts ${here.annualKwh} kWh, pvlib ${viaPvlib.annualKwh} kWh (${pct(viaPvlib.annualKwh, here.annualKwh)})`);
    expect(Math.abs(viaPvlib.annualKwh - here.annualKwh) / here.annualKwh).toBeLessThan(0.01);

    const estimate = await one<{ provenance: string; inputs: Record<string, any> }>(db, 'select provenance, inputs from estimates where id = $1', [viaPvlib.estimateId]);
    expect(estimate.provenance).toBe(installed!.version);
    expect(estimate.inputs).toMatchObject({ profile: 'pvwatts', engine: { name: 'pvlib', version: installed!.version, contract: 1 }, model: { pvlib: installed!.dependencies.pvlib } });
    const series = await db.query<{ quantity_code: string; n: number }>(
      `select s.quantity_code, count(v.*)::int n from series s join series_values v on v.series_id = s.id where s.name = 'pvlib 2023-2023' group by s.quantity_code order by 1`,
    );
    expect(series.rows).toEqual([{ quantity_code: 'module_temperature', n: 8760 }, { quantity_code: 'poa_irradiance', n: 8760 }, { quantity_code: 'production_energy', n: 8760 }]);
  });
});
