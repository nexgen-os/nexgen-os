// An address goes to a point and a point to an address, on two open
// geocoders, with the precision and the source the participant will keep; and the
// participant accepts exactly what the library hands it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { addressLines, placeFields, type Fetch, type Place } from '@nexgen-os/core';
import { nominatim } from '@nexgen-os/nominatim';
import { photon } from '@nexgen-os/photon';
import { USER_A, freshDatabase, one, organisation, participant } from './helpers/db.js';

/** A fetch that records what it was asked and answers from a table of URLs. */
function fakeFetch(answers: Record<string, unknown>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => answers[key] };
  };
  return { fetch, calls };
}

const nominatimHouse = {
  place_id: 1, osm_type: 'way', osm_id: 123456789, lat: '50.84673', lon: '4.35247', category: 'building', type: 'yes', addresstype: 'building',
  display_name: '12, Rue de la Loi, Bruxelles, 1000, België / Belgique / Belgien',
  address: { house_number: '12', road: 'Rue de la Loi', city: 'Bruxelles', 'ISO3166-2-lvl4': 'BE-BRU', postcode: '1000', country: 'Belgique', country_code: 'be' },
};
const nominatimStreet = {
  place_id: 2, osm_type: 'way', osm_id: 22, lat: '48.8566', lon: '2.3522', addresstype: 'road', display_name: 'Rue de Rivoli, Paris, 75001, France',
  address: { road: 'Rue de Rivoli', city: 'Paris', postcode: '75001', 'ISO3166-2-lvl4': 'FR-IDF', 'ISO3166-2-lvl6': 'FR-75', country: 'France', country_code: 'fr' },
};

describe('nominatim', () => {
  it('turns a typed address into a rooftop place with its OpenStreetMap id', async () => {
    const { fetch, calls } = fakeFetch({ 'https://nominatim.openstreetmap.org/search': [nominatimHouse] });
    const g = nominatim({ userAgent: 'nexgen-os tests', fetch });
    const places = await g.search('rue de la loi 12 bruxelles', { country: 'BE', language: 'fr', limit: 3 });
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      address: { street: 'Rue de la Loi 12', postal_code: '1000', city: 'Bruxelles', region: 'BE-BRU', country: 'BE' },
      lon: 4.35247,
      lat: 50.84673,
      precision: 'rooftop',
      source_code: 'nominatim',
      identifier: { scheme: 'osm', value: 'way/123456789' },
    });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('countrycodes')).toBe('be');
    expect(url.searchParams.get('accept-language')).toBe('fr');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(calls[0].headers?.['User-Agent']).toBe('nexgen-os tests');
  });

  it('turns a point into an address, street precision when there is no number, and null where there is nothing', async () => {
    const { fetch } = fakeFetch({
      'https://nominatim.openstreetmap.org/reverse?lat=48.8566': nominatimStreet,
      'https://nominatim.openstreetmap.org/reverse?lat=0': { error: 'Unable to geocode' },
    });
    const g = nominatim({ userAgent: 'nexgen-os tests', fetch });
    const place = await g.reverse(2.3522, 48.8566);
    expect(place).toMatchObject({ address: { street: 'Rue de Rivoli', region: 'FR-IDF', country: 'FR' }, precision: 'street' });
    expect(await g.reverse(0, 0)).toBeNull();
  });

  it('refuses to run without a user agent, by name', () => {
    expect(() => nominatim({ userAgent: '' })).toThrow(/user_agent_required/);
  });
});

describe('photon', () => {
  const features = {
    features: [
      { geometry: { coordinates: [4.35247, 50.84673] }, properties: { osm_type: 'W', osm_id: 123456789, type: 'house', housenumber: '12', street: 'Rue de la Loi', postcode: '1000', city: 'Bruxelles', state: 'Bruxelles-Capitale', country: 'Belgique', countrycode: 'BE' } },
      { geometry: { coordinates: [2.3522, 48.8566] }, properties: { osm_type: 'R', osm_id: 7444, type: 'city', name: 'Paris', country: 'France', countrycode: 'FR' } },
    ],
  };

  it('searches as you type and filters the country on the answers', async () => {
    const { fetch, calls } = fakeFetch({ 'https://photon.komoot.io/api': features });
    const g = photon({ fetch });
    const all = await g.search('rue de la loi', { near: { lon: 4.35, lat: 50.85 }, language: 'fr-BE' });
    expect(all.map((p) => [p.address.country, p.precision])).toEqual([['BE', 'rooftop'], ['FR', 'city']]);
    expect(all[0].identifier).toEqual({ scheme: 'osm', value: 'way/123456789' });
    expect(all[0].address.region).toBeNull();
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('lang')).toBe('fr');
    expect(url.searchParams.get('lat')).toBe('50.85');
    const belgian = await g.search('rue de la loi', { country: 'be' });
    expect(belgian.map((p) => p.address.country)).toEqual(['BE']);
  });

  it('reverses a point and says when a geocoder is unavailable', async () => {
    const { fetch } = fakeFetch({ 'https://photon.komoot.io/reverse': features });
    const g = photon({ fetch });
    expect((await g.reverse(4.35, 50.85))?.label).toBe('Rue de la Loi 12, 1000, Bruxelles, Belgique');
    const down = photon({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
    await expect(down.search('x')).rejects.toThrow(/geocoder_unavailable: 503/);
  });
});

describe('a place on a participant', () => {
  let db: PGlite;
  let org: string;
  const place: Place = {
    address: { street: 'Rue de la Loi 12', address_extra: 'Floor 3', postal_code: '1000', city: 'Bruxelles', region: 'BE-BRU', country: 'BE' },
    lon: 4.35247, lat: 50.84673, precision: 'rooftop', source_code: 'nominatim', label: 'Rue de la Loi 12, Bruxelles',
  };

  beforeAll(async () => {
    db = await freshDatabase();
    org = await organisation(db, 'A firm', USER_A);
  });
  afterAll(async () => {
    await db.close();
  });

  it('writes the address, the point, the precision and the source, and refuses a precision it does not know', async () => {
    const id = await participant(db, { organisation_id: org, name: 'Office', ...placeFields(place) });
    const row = await one<{ street: string; address_extra: string; region: string; how_precise: string; source: string; lon: number; lat: number; dims: number }>(
      db,
      `select street, address_extra, region, location_precision how_precise, location_source_code source,
              ST_X(geometry) lon, ST_Y(geometry) lat, ST_NDims(geometry) dims
         from participants where id = $1`,
      [id],
    );
    expect(row).toEqual({ street: 'Rue de la Loi 12', address_extra: 'Floor 3', region: 'BE-BRU', how_precise: 'rooftop', source: 'nominatim', lon: 4.35247, lat: 50.84673, dims: 3 });
    await expect(participant(db, { organisation_id: org, name: 'Vague', country: 'BE', location_precision: 'somewhere' })).rejects.toThrow(/participants_location_precision/);
    expect(addressLines(place.address)).toEqual(['Rue de la Loi 12', 'Floor 3', '1000 Bruxelles', 'BE-BRU', 'BE']);
  });
});
