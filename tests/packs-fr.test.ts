// The first country pack: its rows load on the core, its address register
// answers as a geocoder of the core's shape, and the chain asks it first for
// a French search, the open fallback otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderFor, type Fetch, type Geocoder, type Place } from '../formats/geocoding/index.js';
import { ban } from '../packs/fr/geocoding.js';
import { USER_A, freshDatabase, insert, one, organisation } from './helpers/db.js';

const banAnswer = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.316909, 48.870267] },
      properties: { label: '55 Rue du Faubourg Saint-Honoré 75008 Paris', score: 0.97, housenumber: '55', id: '75108_3522_00055', type: 'housenumber', name: '55 Rue du Faubourg Saint-Honoré', postcode: '75008', citycode: '75108', city: 'Paris', context: '75, Paris, Île-de-France', street: 'Rue du Faubourg Saint-Honoré' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [3.8767, 43.6085] },
      properties: { label: 'Place de la Comédie 34000 Montpellier', score: 0.8, id: '34172_1960', type: 'street', name: 'Place de la Comédie', postcode: '34000', citycode: '34172', city: 'Montpellier', context: '34, Hérault, Occitanie' } },
  ],
};
const fetchWith = (body: unknown): Fetch => async () => ({ ok: true, status: 200, json: async () => body });
const stub = (code: string, places: Place[]): Geocoder => ({
  source_code: code,
  search: async () => places,
  reverse: async () => places[0] ?? null,
});
const somewhere = (code: string): Place => ({ address: { country: 'FR' }, lon: 0, lat: 0, precision: 'city', source_code: code, label: code });

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase([], ['fr']);
});

afterAll(async () => {
  await db.close();
});

describe('the fr pack', () => {
  it('brings its identifier schemes and sources, and the schemes check their patterns', async () => {
    const rows = await db.query<{ code: string; published_by: string }>(`select code, published_by from sources where published_by = 'pack:fr' order by code`);
    expect(rows.rows.map((r) => r.code)).toEqual(['ban', 'geo_api_gouv']);
    const org = await organisation(db, 'Une commune', USER_A);
    const site = await insert(db, 'sites', { organisation_id: org, name: 'Mairie', country: 'FR' });
    const meter = await insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '12345678901234', scheme: 'prm' });
    expect(meter).toBeTruthy();
    await expect(insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '1234', scheme: 'prm' })).rejects.toThrow(/invalid_identifier/);
    const n = await one<{ n: number }>(db, `select count(*)::int n from id_schemes where code in ('prm', 'ban_address', 'insee')`);
    expect(n.n).toBe(3);
  });

  it('reads the national address register with house-number precision and the department as region', async () => {
    const g = ban({ fetch: fetchWith(banAnswer) });
    const places = await g.search('55 rue du faubourg saint honoré paris');
    expect(places[0]).toMatchObject({
      address: { street: 'Rue du Faubourg Saint-Honoré 55', postal_code: '75008', city: 'Paris', region: 'FR-75', municipality_code: '75108', country: 'FR' },
      precision: 'rooftop',
      source_code: 'ban',
      external_id: { scheme: 'ban_address', value: '75108_3522_00055' },
    });
    expect(places[1]).toMatchObject({ address: { street: 'Place de la Comédie', region: 'FR-34' }, precision: 'street' });
    expect((await g.reverse(2.3169, 48.8703))?.label).toBe('55 Rue du Faubourg Saint-Honoré 75008 Paris');
  });
});

describe('the chain of geocoders', () => {
  it('asks the national register first, the open fallback next, the commercial one last', async () => {
    const chain = geocoderFor({
      national: { FR: stub('ban', [somewhere('ban')]) },
      fallback: stub('nominatim', []),
      commercial: stub('mapbox', [somewhere('mapbox')]),
    });
    expect((await chain.search('x', { country: 'FR' }))[0].source_code).toBe('ban');
    expect((await chain.search('x', { country: 'BE' }))[0].source_code).toBe('mapbox');
    const open = geocoderFor({ national: { FR: stub('ban', []) }, fallback: stub('photon', [somewhere('photon')]) });
    expect((await open.search('x', { country: 'FR' }))[0].source_code).toBe('photon');
    expect(await geocoderFor({ fallback: stub('photon', []) }).search('x')).toEqual([]);
    // Belgium keeps one register per region: each is asked in turn before the fallback.
    const belgium = geocoderFor({
      national: { 'BE-BRU': stub('urbis', []), 'BE-VLG': stub('geopunt', [somewhere('geopunt')]), FR: stub('ban', [somewhere('ban')]) },
      fallback: stub('photon', [somewhere('photon')]),
    });
    expect((await belgium.search('x', { country: 'be' }))[0].source_code).toBe('geopunt');
    expect((await belgium.search('x', { country: 'FR' }))[0].source_code).toBe('ban');
  });
});
