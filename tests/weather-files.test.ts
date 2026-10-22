// A weather file in the database: the series the format library reads are
// stored on a place through the core's importer, as a simulated typical year
// with its source, and read back through resample() as an EPW file that
// reads the same.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readEpw, writeEpw, type WeatherFile } from '@nexgen-os/weather-files';
import { exportWeatherYear, importWeatherFile } from '@nexgen-os/core';
import { USER_A, freshDatabase, one, organisation, repoRoot, participant } from './helpers/db.js';

const fixture = (name: string) => readFile(`${repoRoot}/packages/formats/weather-files/tests/fixtures/${name}`, 'utf8');
const valuesOf = (file: WeatherFile, quantity: string) => file.series.find((s) => s.quantity_code === quantity)!.values;

describe('a weather file in the database', () => {
  let db: PGlite;
  let org: string;
  let home: string;

  beforeAll(async () => {
    db = await freshDatabase(['solar']);
    org = await organisation(db, 'A cooperative', USER_A);
    home = await participant(db, { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores a typical year as simulated series named after its years, with their source, and replaces them on a second import', async () => {
    const file = readEpw(await fixture('pvgis-tmy-brussels-3-days.epw'), { utcOffsetHours: 0 });
    const first = await importWeatherFile(db, { organisationId: org, objectKind: 'participant', objectId: home }, file, { sourceCode: 'pvgis' });
    expect(first.series.map((s) => [s.quantity_code, s.inserted])).toEqual([['ghi', 72], ['dni', 72], ['dhi', 72], ['temperature', 72], ['wind_speed', 72]]);
    const again = await importWeatherFile(db, { organisationId: org, objectKind: 'participant', objectId: home }, file, { sourceCode: 'pvgis' });
    expect(again.series.map((s) => s.seriesId)).toEqual(first.series.map((s) => s.seriesId));

    const stored = await one<{ n: number; kinds: string[]; names: string[]; sources: string[]; values: number }>(db, `
      select count(*)::int n, array_agg(distinct kind) kinds, array_agg(distinct name) names, array_agg(distinct source_code) sources,
             (select count(*)::int from series_values v where v.series_id in (select id from series where object_id = $1)) as values
        from series where object_id = $1`, [home]);
    expect(stored).toEqual({ n: 5, kinds: ['simulated'], names: ['typical year 2005-2020'], sources: ['pvgis'], values: 360 });

    const day = await db.query<{ value: number; samples: number }>(`select value, samples from resample($1, '2020-06-21 00:00+00', '2020-06-22 00:00+00', '1 day', 'UTC')`, [first.series[0].seriesId]);
    const june21 = valuesOf(file, 'ghi').filter((v) => v.at.startsWith('2020-06-21'));
    expect(day.rows[0]).toEqual({ value: expect.closeTo(june21.reduce((s, v) => s + v.value, 0) / 24, 6), samples: 24 }); // an irradiance is a mean
  });

  it('writes the series of a place back as an EPW file that reads the same', async () => {
    const file = readEpw(await fixture('pvgis-tmy-brussels-3-days.epw'), { utcOffsetHours: 0 });
    const text = writeEpw(await exportWeatherYear(db, { objectId: home, sourceCode: 'pvgis', kind: 'simulated', name: 'typical year 2005-2020', year: 2020, location: file.location }));
    const back = readEpw(text);
    for (const s of file.series) expect(valuesOf(back, s.quantity_code)).toEqual(s.values);
  });
});
