// PVGIS answers land in the core's conventions: azimuth from true north
// becomes PVGIS's aspect from south, each hour is dated at its start in UTC,
// watts become kilowatt-hours, and the series store as a simulated run would.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { aspectOf, hourStart, pvgis } from '../connectors/pvgis/index.js';
import { storeSeries } from '../connectors/index.js';
import type { Fetch } from '../formats/geocoding/index.js';
import { USER_A, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const recorded = async (name: string) => JSON.parse(await readFile(`${repoRoot}/tests/fixtures/${name}`, 'utf8')) as unknown;
const fetchWith = (body: unknown) => {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, calls };
};

describe('conventions', () => {
  it('turns a north-clockwise azimuth into a PVGIS aspect and a PVGIS stamp into an hour start in UTC', () => {
    expect([aspectOf(180), aspectOf(90), aspectOf(270), aspectOf(0), aspectOf(225)]).toEqual([0, -90, 90, 180, 45]);
    expect(hourStart('20230101:1210')).toBe('2023-01-01T12:00:00.000Z');
    expect(hourStart('20230630:2330')).toBe('2023-06-30T23:00:00.000Z');
    expect(() => hourStart('2023-01-01 12:00')).toThrow(/pvgis_time_unreadable/);
  });
});

describe('the PVGIS connector', () => {
  let db: PGlite;
  let org: string;
  let site: string;

  beforeAll(async () => {
    db = await freshDatabase();
    org = await organisation(db, 'A cooperative', USER_A);
    site = await insert(db, 'sites', { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  });

  afterAll(async () => {
    await db.close();
  });

  it('reads an hourly series as energy per hour, in-plane irradiance and temperature, and asks PVGIS the right question', async () => {
    const { fetch, calls } = fetchWith(await recorded('pvgis-seriescalc-brussels-2023-48h.json'));
    const got = await pvgis({ fetch }).hourly({ lon: 4.35, lat: 50.85 }, { kwp: 1, azimuth_deg: 180, tilt_deg: 35, mounting: 'building', system_loss_pct: 14 }, { from: 2023, to: 2023 });
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/api/v5_3/seriescalc');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ lat: '50.85', lon: '4.35', aspect: '0', angle: '35', mountingplace: 'building', loss: '14', peakpower: '1', pvcalculation: '1', usehorizon: '1', startyear: '2023', endyear: '2023' });
    expect(got.meta).toMatchObject({ radiation_db: 'PVGIS-SARAH3', meteo_db: 'ERA5', year_min: 2023, horizon: 'DEM-calculated' });
    expect(got.series.map((s) => [s.quantity_code, s.value_kind, s.values.length])).toEqual([
      ['production_energy', 'interval', 48],
      ['poa_irradiance', 'interval', 48],
      ['temperature', 'instant', 48],
    ]);
    expect(got.series[0].values[12]).toEqual({ at: '2023-01-01T12:00:00.000Z', value: 0.35008 });
    expect(got.series[1].values[12]).toEqual({ at: '2023-01-01T12:00:00.000Z', value: 423.09 });
    expect(got.series[2].values[0]).toEqual({ at: '2023-01-01T00:00:00.000Z', value: 15.4 });
  });

  it('stores the energy as a simulated series and reads it back by day in the site time zone', async () => {
    const { fetch } = fetchWith(await recorded('pvgis-seriescalc-brussels-2023-48h.json'));
    const got = await pvgis({ fetch }).hourly({ lon: 4.35, lat: 50.85 }, { kwp: 1, azimuth_deg: 180, tilt_deg: 35, mounting: 'building', system_loss_pct: 14 }, { from: 2023, to: 2023 });
    const { seriesId } = await storeSeries(db, { organisationId: org, objectId: site, sourceCode: 'pvgis', kind: 'simulated' }, got.series[0]);
    const days = await db.query<{ bucket: string; value: number; samples: number }>(`select bucket, value, samples from resample($1, '2023-01-01 00:00+01', '2023-01-03 00:00+01', '1 day')`, [seriesId]);
    expect(days.rows.map((d) => d.samples)).toEqual([23, 24]); // the first Brussels day starts at 23:00 UTC the day before
    const total = got.series[0].values.reduce((s, v) => s + v.value, 0);
    expect(days.rows.reduce((s, d) => s + d.value, 0)).toBeCloseTo(total - got.series[0].values[47].value, 5);
    const kind = await one<{ kind: string; source: string }>(db, 'select kind, source_code source from series where id = $1', [seriesId]);
    expect(kind).toEqual({ kind: 'simulated', source: 'pvgis' });
  });

  it('reads the multi-year yield of the PV calculator', async () => {
    const answer = {
      inputs: { meteo_data: { radiation_db: 'PVGIS-SARAH3', meteo_db: 'ERA5' } },
      outputs: { monthly: { fixed: [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({ month, E_m: month * 10 })) }, totals: { fixed: { E_y: 1016.4, 'H(i)_y': 1213.2 } } },
    };
    const { fetch, calls } = fetchWith(answer);
    const got = await pvgis({ fetch }).yearly({ lon: 3.13, lat: 50.58 }, { kwp: 1, azimuth_deg: 180, tilt_deg: 35, mounting: 'building', system_loss_pct: 14 });
    expect(new URL(calls[0]).pathname).toBe('/api/v5_3/PVcalc');
    expect(got).toEqual({ meta: { radiation_db: 'PVGIS-SARAH3', meteo_db: 'ERA5' }, annual_kwh: 1016.4, monthly_kwh: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], annual_poa_kwh_m2: 1213.2 });
    const down = pvgis({ fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) });
    await expect(down.yearly({ lon: 0, lat: 0 }, { kwp: 1, azimuth_deg: 180, tilt_deg: 35, mounting: 'free', system_loss_pct: 14 })).rejects.toThrow(/source_unavailable: 429/);
  });
});
