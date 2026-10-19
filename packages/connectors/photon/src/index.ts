// Photon — https://github.com/komoot/photon, search as you type on OpenStreetMap, as a connector.
// Source `photon`; the data is OpenStreetMap's (ODbL).

import type { Fetch, Geocoder, Place, Precision } from '@nexgen-os/core';

export interface PhotonOptions {
  /** Default: the public instance of komoot. */
  baseUrl?: string;
  fetch?: Fetch;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: 'N' | 'W' | 'R';
    osm_id?: number;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    locality?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
  };
}

/**
 * A geocoder on Photon. `source_code` is `photon`. Photon has no country
 * filter: `country` is applied on the answers. Regions come back as names,
 * so `region` stays null.
 */
export function photon(options: PhotonOptions = {}): Geocoder {
  const base = trimSlash(options.baseUrl ?? 'https://photon.komoot.io');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  return {
    source_code: 'photon',
    async search(text, search = {}) {
      const params = new URLSearchParams({ q: text, limit: String(search.limit ?? 5) });
      if (search.language) params.set('lang', search.language.slice(0, 2).toLowerCase());
      if (search.near) {
        params.set('lat', String(search.near.lat));
        params.set('lon', String(search.near.lon));
      }
      const body = (await getJson(doFetch, `${base}/api?${params}`, {})) as { features: PhotonFeature[] };
      const wanted = search.country?.toUpperCase();
      return body.features
        .map(fromPhoton)
        .filter((p): p is Place => p !== null && (!wanted || p.address.country === wanted));
    },
    async reverse(lon, lat) {
      const params = new URLSearchParams({ lon: String(lon), lat: String(lat) });
      const body = (await getJson(doFetch, `${base}/reverse?${params}`, {})) as { features: PhotonFeature[] };
      const first = body.features[0];
      return first ? fromPhoton(first) : null;
    },
  };
}

function fromPhoton(feature: PhotonFeature): Place | null {
  const p = feature.properties;
  const country = p.countrycode?.toUpperCase();
  if (!country) return null;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ') || (p.type === 'street' ? (p.name ?? null) : null);
  const city = p.city ?? p.locality ?? p.district ?? null;
  const precision: Precision = p.housenumber || p.type === 'house'
    ? 'rooftop'
    : p.type === 'street'
      ? 'street'
      : p.type === 'county' || p.type === 'state'
        ? 'region'
        : 'city';
  const label = [p.name, street, p.postcode, city, p.country].filter(Boolean).join(', ');
  const place: Place = {
    address: { street, address_extra: null, postal_code: p.postcode ?? null, city, region: null, country },
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    precision,
    source_code: 'photon',
    label,
  };
  const osmType = p.osm_type ? { N: 'node', W: 'way', R: 'relation' }[p.osm_type] : undefined;
  if (osmType && p.osm_id !== undefined) place.external_id = { scheme: 'osm', value: `${osmType}/${p.osm_id}` };
  return place;
}


async function getJson(doFetch: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
