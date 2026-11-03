// The weather module: which source a participant reads for one purpose, resolved from
// its own choice, its organisation, the rules of its country and region, and
// the coverage of the sources; and the point (grid cell or station) the participant
// is linked to, shared by every participant of the organisation in the same cell.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, participant } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;
let home: string;

const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const sourceFor = async (participantId: string, purpose: string) =>
  (await one<{ code: string }>(db, 'select weather.source_for($1, $2) code', [participantId, purpose])).code;

beforeAll(async () => {
  db = await freshDatabase(['weather']);
  org = await organisation(db, 'An installer', USER_A);
  home = await participant(db, {
    organisation_id: org, name: 'Farm', country: 'FR', region: 'FR-ARA', geometry: point(4.8262, 45.7578),
  });
  // Two sources a pack or a private package would bring, to tell each level apart.
  await db.exec(`
    insert into sources (code, name, countries, published_by) values
      ('regional_office', 'A regional weather office', '{FR}', 'pack:test'),
      ('station_network', 'A network of stations', '{}', 'pack:test');
    insert into weather.sources (source_code, purposes, resolution_m, grid_deg, priority, published_by) values
      ('regional_office', '{irradiance,temperature}', 1300, 0.0125, 50, 'pack:test'),
      ('station_network', '{irradiance,temperature,history}', null, null, 60, 'pack:test');
  `);
});

afterAll(async () => {
  await db.close();
});

describe('the weather module', () => {
  it('installs on the core with its sources, its points and its attribute type', async () => {
    const m = await one<{ schema_name: string }>(db, `select schema_name from modules where code = 'weather'`);
    expect(m.schema_name).toBe('weather');
    const weatherSources = await db.query<{ source_code: string; grid_deg: string; purposes: string[] }>(
      `select source_code, grid_deg::text, purposes from weather.sources where published_by = 'weather' order by source_code`,
    );
    expect(weatherSources.rows).toEqual([
      { source_code: 'open_meteo', grid_deg: '0.01', purposes: ['irradiance', 'temperature', 'wind', 'history', 'forecast'] },
      { source_code: 'pvgis', grid_deg: '0.05', purposes: ['irradiance', 'typical_year'] },
    ]);
    expect((await one<{ t: string | null }>(db, `select to_regclass('weather.participants')::text t`)).t).toBe('weather.participants');
    const prop = await one<{ published_by: string; datatype: string; applies_to: string[] }>(
      db, `select published_by, datatype, applies_to from attribute_types where code = 'weather_source'`);
    expect(prop).toEqual({ published_by: 'weather', datatype: 'text', applies_to: ['participant', 'project'] });
  });
});

describe('source_for', () => {
  it('resolves each level over the previous one', async () => {
    // (d) Default by coverage: PVGIS has the best priority for irradiance,
    // Open-Meteo is the only core source for a forecast.
    expect(await sourceFor(home, 'irradiance')).toBe('pvgis');
    expect(await sourceFor(home, 'forecast')).toBe('open_meteo');

    // (c) A rule for the country, then a rule for the region of the participant.
    await db.query(`insert into weather.rules (country, purpose, source_code, published_by) values ('FR', 'irradiance', 'open_meteo', 'pack:test')`);
    expect(await sourceFor(home, 'irradiance')).toBe('open_meteo');
    await db.query(`insert into weather.rules (country, regions, purpose, source_code, published_by) values ('FR', '{FR-ARA}', 'irradiance', 'regional_office', 'pack:test')`);
    expect(await sourceFor(home, 'irradiance')).toBe('regional_office');
    // A participant in another region keeps the country's rule.
    const other = await participant(db, { organisation_id: org, name: 'Barn', country: 'FR', region: 'FR-BRE' });
    expect(await sourceFor(other, 'irradiance')).toBe('open_meteo');

    // (b) An active connector of the organisation, for that purpose.
    await db.query(
      `insert into connectors (organisation_id, source_code, name, config) values ($1, 'station_network', 'Our stations', '{"purpose": "irradiance"}')`,
      [org],
    );
    expect(await sourceFor(home, 'irradiance')).toBe('station_network');
    // Restricted to irradiance: temperature still follows the defaults.
    expect(await sourceFor(home, 'temperature')).toBe('open_meteo');

    // (a) The participant's own choice.
    await db.query(`select set_attribute('participant', $1, 'weather_source', '"pvgis"')`, [home]);
    expect(await sourceFor(home, 'irradiance')).toBe('pvgis');
  });

  it('raises a named error when no source serves the purpose', async () => {
    await expect(sourceFor(home, 'snowfall')).rejects.toThrow(/weather_source_unknown/);
  });
});

describe('point_for', () => {
  let near: string;
  let far: string;

  beforeAll(async () => {
    // About 300 m east of the farm, in the same 0.01° cell.
    near = await participant(db, { organisation_id: org, name: 'Neighbour', country: 'FR', geometry: point(4.8300, 45.7580) });
    far = await participant(db, { organisation_id: org, name: 'Elsewhere', country: 'FR', geometry: point(4.9000, 45.7600) });
  });

  it('shares one point between participants of the same cell, and says which participants read it', async () => {
    const a = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [home]);
    const b = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [near]);
    const c = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [far]);
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    // Asking again finds the same point and records nothing twice.
    expect((await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [home])).id).toBe(a.id);

    const p = await one<{ cell_lon: string; cell_lat: string; resolution_m: number }>(
      db, `select p.cell_lon::text, p.cell_lat::text, p.resolution_m from weather.points p where p.id = $1`, [a.id],
    );
    expect(p).toEqual({ cell_lon: '4.83', cell_lat: '45.76', resolution_m: 1000 });
    const readers = await db.query<{ participant_id: string }>(
      `select participant_id from weather.participants where point_id = $1 order by participant_id`, [a.id]);
    expect(readers.rows.map((r) => r.participant_id).sort()).toEqual([home, near].sort());
  });

  it('refuses a second point in the same cell of a source', async () => {
    await expect(
      insert(db, 'weather.points', { organisation_id: org, name: 'Duplicate', source_code: 'open_meteo', geometry: point(4.8301, 45.7601) }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('raises a named error for a participant without a position', async () => {
    const nowhere = await participant(db, { organisation_id: org, name: 'Nowhere', country: 'FR' });
    await expect(db.query(`select weather.point_for($1, 'open_meteo')`, [nowhere])).rejects.toThrow(/participant_without_position/);
  });

  it('shows the points to the members of their organisation only', async () => {
    await organisation(db, 'Another firm', USER_B);
    const mine = await asUser(db, USER_A, () => db.query('select id from weather.points'));
    const theirs = await asUser(db, USER_B, () => db.query('select id from weather.points'));
    expect(mine.rows).toHaveLength(2);
    expect(theirs.rows).toHaveLength(0);
  });
});

describe('the time zone of a point', () => {
  let firm: string;
  // Two participants in one 0.05° cell of PVGIS, the first without a time zone.
  let unzoned: string;
  let zoned: string;
  let pointId: string;

  beforeAll(async () => {
    firm = await organisation(db, 'A weather reader', USER_A);
    unzoned = await participant(db, { organisation_id: firm, name: 'No zone', country: 'BE', geometry: point(4.351, 50.851) });
    zoned = await participant(db, { organisation_id: firm, name: 'Brussels', country: 'BE', time_zone: 'Europe/Brussels', geometry: point(4.352, 50.852) });
  });

  it('is taken from the first participant with one that reads the point, and kept', async () => {
    pointId = (await one<{ id: string }>(db, `select weather.point_for($1, 'pvgis') id`, [unzoned])).id;
    const zoneOf = async () => (await one<{ time_zone: string | null }>(db, 'select time_zone from weather.points where id = $1', [pointId])).time_zone;
    expect(await zoneOf()).toBeNull();
    expect((await one<{ id: string }>(db, `select weather.point_for($1, 'pvgis') id`, [zoned])).id).toBe(pointId);
    expect(await zoneOf()).toBe('Europe/Brussels');
    // A neighbour across a border of time zones in the same cell leaves it as it is.
    const other = await participant(db, { organisation_id: firm, name: 'Elsewhere zoned', country: 'BE', time_zone: 'UTC', geometry: point(4.353, 50.853) });
    await db.query(`select weather.point_for($1, 'pvgis')`, [other]);
    expect(await zoneOf()).toBe('Europe/Brussels');
  });

  it('is a time zone Postgres knows', async () => {
    await expect(db.query(`update weather.points set time_zone = 'Europe/Atlantis' where id = $1`, [pointId])).rejects.toThrow(/time_zone_unknown/);
  });

  it('cuts the series of the point by day, through time_zone_of()', async () => {
    // Hourly temperatures from 22:00 UTC on 1 June to 22:00 UTC on 3 June:
    // 10 °C until midnight in Brussels (22:00 UTC), 20 °C the next day.
    const hours = Array.from({ length: 48 }, (_, h) => new Date(Date.UTC(2026, 5, 1, 22 + h)).toISOString());
    const values = hours.map((_, h) => (h < 24 ? 10 : 20));
    await db.query(`select store(null, $1::timestamptz[], $2::float8[], p_series => $3::jsonb)`, [
      hours, values, JSON.stringify({
        object_kind: 'organisation', object_id: firm, quantity_code: 'temperature', value_kind: 'instant', step: '1 hour',
        source_code: 'pvgis', external_ref: pointId, name: 'PVGIS point',
      }),
    ]);
    const series = (await one<{ id: string }>(db, `select id from series where external_ref = $1`, [pointId])).id;
    expect((await one<{ tz: string | null }>(db, 'select weather.time_zone_of($1) tz', [series])).tz).toBe('Europe/Brussels');
    // Without it, the core finds no participant and no time zone.
    await expect(db.query(`select * from resample($1, '2026-06-02', '2026-06-04', '1 day')`, [series])).rejects.toThrow(/time_zone_required/);
    const days = await db.query<{ bucket: string; value: number }>(
      `select bucket::text, value from resample($1, '2026-06-01T22:00:00Z', '2026-06-03T22:00:00Z', '1 day', weather.time_zone_of($1))`, [series]);
    expect(days.rows.map((r) => r.value)).toEqual([10, 20]);
  });

  it('is the participant\'s for a series of the participant', async () => {
    const own = (await one<{ id: string }>(db, `select series_ensure('participant', $1, 'temperature', 'measured', 'instant', '1 hour') id`, [zoned])).id;
    expect((await one<{ tz: string | null }>(db, 'select weather.time_zone_of($1) tz', [own])).tz).toBe('Europe/Brussels');
    const none = (await one<{ id: string }>(db, `select series_ensure('participant', $1, 'temperature', 'measured', 'instant', '1 hour') id`, [unzoned])).id;
    expect((await one<{ tz: string | null }>(db, 'select weather.time_zone_of($1) tz', [none])).tz).toBeNull();
  });
});
