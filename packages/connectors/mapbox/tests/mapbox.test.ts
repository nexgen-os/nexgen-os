// @nexgen-os/mapbox, offline: answers of the Geocoding API v6 built after
// the examples of its documentation, then its place in the chain of
// geocoders, after the country's register and the open fallback.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderChain, registerSource, type Db, type Fetch, type Geocoder, type Place } from '@nexgen-os/core';
import { mapbox, mapboxSource } from '../src/index.js';
import { freshDatabase } from '../../../../tests/helpers/db.js';

const answer = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
/** The country of the first feature of an answer, as the fixture writes it: data, never a literal of the test. */
const countryOf = (name: string) => (answer(name) as { features: { properties: { context: { country: { country_code: string } } } }[] })
  .features[0]!.properties.context.country.country_code;

function recording(body: unknown, status = 200): { fetch: Fetch; urls: URL[] } {
  const urls: URL[] = [];
  return { urls, fetch: async (url) => { urls.push(new URL(url)); return { ok: status === 200, status, json: async () => body }; } };
}

describe('the Geocoding API v6', () => {
  it('searches as you type, in the standard place shape, with the region in ISO 3166-2 and the precision of the point', async () => {
    const api = recording(answer('forward-address.json'));
    const places = await mapbox({ accessToken: 'test-token', fetch: api.fetch }).search('rue de la loi 16', { country: 'be', language: 'fr', near: { lon: 4.35, lat: 50.85 } });
    expect(places[0]).toEqual({
      address: { address_line1: 'Rue de la Loi 16', address_line2: null, postal_code: '1000', city: 'Bruxelles', region: 'BE-BRU', municipality_code: null, country: countryOf('forward-address.json') },
      lon: 4.35212, lat: 50.84673, precision: 'rooftop', source_code: 'mapbox', label: 'Rue de la Loi 16, 1000 Bruxelles, Belgium',
    });
    expect(places[1]).toMatchObject({ precision: 'city', address: { address_line1: null, city: null, region: 'BE-BRU' } });
    const url = api.urls[0]!;
    expect(url.pathname).toBe('/search/geocode/v6/forward');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      access_token: 'test-token', permanent: 'true', autocomplete: 'true', country: 'be', language: 'fr', proximity: '4.35,50.85', limit: '5',
    });
  });

  it('geocodes a full address once, without autocomplete', async () => {
    const api = recording(answer('forward-address.json'));
    const place = await mapbox({ accessToken: 't', fetch: api.fetch }).forward('Rue de la Loi 16, 1000 Bruxelles');
    expect(place?.address.address_line1).toBe('Rue de la Loi 16');
    expect(Object.fromEntries(api.urls[0]!.searchParams)).toMatchObject({ autocomplete: 'false', limit: '1' });
  });

  it('gives the full address at a point, an interpolated one at street precision', async () => {
    const api = recording(answer('reverse-interpolated.json'));
    const place = await mapbox({ accessToken: 't', fetch: api.fetch }).reverse(2.2945, 48.8583);
    expect(place).toMatchObject({
      address: { address_line1: '5 Avenue Anatole France', postal_code: '75007', city: 'Paris', region: 'FR-IDF', country: countryOf('reverse-interpolated.json') },
      precision: 'street', label: '5 Avenue Anatole France, 75007 Paris, France',
    });
    expect(Object.fromEntries(api.urls[0]!.searchParams)).toMatchObject({ longitude: '2.2945', latitude: '48.8583', types: 'address' });
    expect(await mapbox({ accessToken: 't', fetch: recording({ features: [] }).fetch }).reverse(0, 0)).toBeNull();
  });

  it('refuses without its token, asks temporary geocoding only when told, and never prints the token', async () => {
    expect(() => mapbox({ accessToken: '' })).toThrow(/secret_not_found/);
    const api = recording({ features: [] });
    await mapbox({ accessToken: 't', permanent: false, fetch: api.fetch }).search('x');
    expect(api.urls[0]!.searchParams.has('permanent')).toBe(false);
    await expect(mapbox({ accessToken: 'very-secret', fetch: recording({}, 401).fetch }).search('x'))
      .rejects.toThrow(/^geocoder_unavailable: 401 from https:\/\/api\.mapbox\.com\/search\/geocode\/v6\/forward\?access_token=…&/);
    await expect(mapbox({ accessToken: 'very-secret', fetch: recording({}, 401).fetch }).search('x')).rejects.not.toThrow(/very-secret/);
  });
});

describe('in the chain of geocoders', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  it('is the commercial one, asked after the register of the country and the open fallback, whatever the order named', async () => {
    await registerSource(db as unknown as Db, mapboxSource);
    expect((await db.query(`select auth, redistributable, countries, retention_days from sources where code = 'mapbox'`)).rows[0])
      .toEqual({ auth: 'api_key', redistributable: false, countries: [], retention_days: null });
    await db.query(`insert into sources (code, name, countries, published_by) values ('zz_register', 'Testland addresses', '{ZZ}', 'pack:zz')`);
    const asked: string[] = [];
    const stub = (code: string, places: Place[] = []): Geocoder => ({
      source_code: code, search: async () => { asked.push(code); return places; }, reverse: async () => null,
    });
    const found: Place = { address: { country: 'ZZ' }, lon: 1, lat: 2, precision: 'rooftop', source_code: 'mapbox', label: 'x' };
    const chain = await geocoderChain(db as unknown as Db, { mapbox: stub('mapbox', [found]), nominatim: stub('nominatim'), zz_register: stub('zz_register') });
    expect((await chain!.search('1 Main Street', { country: 'ZZ' }))[0]?.source_code).toBe('mapbox');
    expect(asked).toEqual(['zz_register', 'nominatim', 'mapbox']);
  });
});
