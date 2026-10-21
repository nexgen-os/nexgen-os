// The weather module: which model a site reads for one purpose, resolved from
// its own choice, its organisation, the rules of its country and region, and
// the coverage of the models; and the point (grid cell or station) the site
// is linked to, shared by every site of the organisation in the same cell.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, participant } from './helpers/db.js';

let db: PGlite;
let org: string;
let site: string;

const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const sourceFor = async (siteId: string, purpose: string) =>
  (await one<{ code: string }>(db, 'select weather.source_for($1, $2) code', [siteId, purpose])).code;

beforeAll(async () => {
  db = await freshDatabase(['weather']);
  org = await organisation(db, 'An installer', USER_A);
  site = await participant(db, {
    organisation_id: org, name: 'Farm', country: 'FR', region: 'FR-ARA', geometry: point(4.8262, 45.7578),
  });
  // Two models a pack or a private package would bring, to tell each level apart.
  await db.exec(`
    insert into sources (code, name, countries, published_by) values
      ('regional_office', 'A regional weather office', '{FR}', 'pack:test'),
      ('station_network', 'A network of stations', '{}', 'pack:test');
    insert into weather.models (source_code, purposes, resolution_m, grid_deg, priority, published_by) values
      ('regional_office', '{irradiance,temperature}', 1300, 0.0125, 50, 'pack:test'),
      ('station_network', '{irradiance,temperature,history}', null, null, 60, 'pack:test');
  `);
});

afterAll(async () => {
  await db.close();
});

describe('the weather module', () => {
  it('installs on the core with its models, link type and property', async () => {
    const m = await one<{ schema_name: string }>(db, `select schema_name from modules where code = 'weather'`);
    expect(m.schema_name).toBe('weather');
    const models = await db.query<{ source_code: string; grid_deg: string; purposes: string[] }>(
      `select source_code, grid_deg::text, purposes from weather.models where published_by = 'weather' order by source_code`,
    );
    expect(models.rows).toEqual([
      { source_code: 'open_meteo', grid_deg: '0.01', purposes: ['irradiance', 'temperature', 'wind', 'history', 'forecast'] },
      { source_code: 'pvgis', grid_deg: '0.05', purposes: ['irradiance', 'typical_year'] },
    ]);
    const link = await one<{ published_by: string; subject_kinds: string[]; object_kinds: string[] }>(
      db, `select published_by, subject_kinds, object_kinds from link_types where code = 'weather_from'`);
    expect(link).toEqual({ published_by: 'weather', subject_kinds: ['participant'], object_kinds: ['weather_point'] });
    const prop = await one<{ published_by: string; datatype: string; applies_to: string[] }>(
      db, `select published_by, datatype, applies_to from property_defs where code = 'weather_source'`);
    expect(prop).toEqual({ published_by: 'weather', datatype: 'text', applies_to: ['participant', 'project'] });
  });
});

describe('source_for', () => {
  it('resolves each level over the previous one', async () => {
    // (d) Default by coverage: PVGIS has the best priority for irradiance,
    // Open-Meteo is the only core model for a forecast.
    expect(await sourceFor(site, 'irradiance')).toBe('pvgis');
    expect(await sourceFor(site, 'forecast')).toBe('open_meteo');

    // (c) A rule for the country, then a rule for the site's region.
    await db.query(`insert into weather.rules (country, purpose, source_code, published_by) values ('FR', 'irradiance', 'open_meteo', 'pack:test')`);
    expect(await sourceFor(site, 'irradiance')).toBe('open_meteo');
    await db.query(`insert into weather.rules (country, regions, purpose, source_code, published_by) values ('FR', '{FR-ARA}', 'irradiance', 'regional_office', 'pack:test')`);
    expect(await sourceFor(site, 'irradiance')).toBe('regional_office');
    // A site in another region keeps the country's rule.
    const other = await participant(db, { organisation_id: org, name: 'Barn', country: 'FR', region: 'FR-BRE' });
    expect(await sourceFor(other, 'irradiance')).toBe('open_meteo');

    // (b) An active connector of the organisation, for that purpose.
    await db.query(
      `insert into connectors (organisation_id, source_code, name, config) values ($1, 'station_network', 'Our stations', '{"purpose": "irradiance"}')`,
      [org],
    );
    expect(await sourceFor(site, 'irradiance')).toBe('station_network');
    // Restricted to irradiance: temperature still follows the defaults.
    expect(await sourceFor(site, 'temperature')).toBe('open_meteo');

    // (a) The site's own choice.
    await db.query(`select set_attribute('participant', $1, 'weather_source', '"pvgis"')`, [site]);
    expect(await sourceFor(site, 'irradiance')).toBe('pvgis');
  });

  it('raises a named error when no model serves the purpose', async () => {
    await expect(sourceFor(site, 'snowfall')).rejects.toThrow(/weather_source_unknown/);
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

  it('shares one point between sites of the same cell and links them to it', async () => {
    const a = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [site]);
    const b = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [near]);
    const c = await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [far]);
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    // Asking again finds the same point and adds no second link.
    expect((await one<{ id: string }>(db, `select weather.point_for($1, 'open_meteo') id`, [site])).id).toBe(a.id);

    const p = await one<{ cell_lon: string; cell_lat: string; resolution_m: number; kind: string }>(
      db,
      `select p.cell_lon::text, p.cell_lat::text, p.resolution_m, k.kind
         from weather.points p join kinds k on k.table_name = 'weather.points' where p.id = $1`,
      [a.id],
    );
    expect(p).toEqual({ cell_lon: '4.83', cell_lat: '45.76', resolution_m: 1000, kind: 'weather_point' });
    const links = await db.query<{ subject_id: string }>(
      `select subject_id from links where type_code = 'weather_from' and object_kind = 'weather_point' and object_id = $1 order by subject_id`, [a.id]);
    expect(links.rows.map((r) => r.subject_id).sort()).toEqual([site, near].sort());
  });

  it('refuses a second point in the same cell of a model', async () => {
    await expect(
      insert(db, 'weather.points', { organisation_id: org, name: 'Duplicate', source_code: 'open_meteo', geometry: point(4.8301, 45.7601) }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('raises a named error for a site without a position', async () => {
    const nowhere = await participant(db, { organisation_id: org, name: 'Nowhere', country: 'FR' });
    await expect(db.query(`select weather.point_for($1, 'open_meteo')`, [nowhere])).rejects.toThrow(/site_without_position/);
  });

  it('shows the points to the members of their organisation only', async () => {
    await organisation(db, 'Another firm', USER_B);
    const mine = await asUser(db, USER_A, () => db.query('select id from weather.points'));
    const theirs = await asUser(db, USER_B, () => db.query('select id from weather.points'));
    expect(mine.rows).toHaveLength(2);
    expect(theirs.rows).toHaveLength(0);
  });
});
