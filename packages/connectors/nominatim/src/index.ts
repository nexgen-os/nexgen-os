// Nominatim — https://nominatim.org, the OpenStreetMap geocoder, as a connector.
// Source `nominatim`; the data is OpenStreetMap's (ODbL).

import type { Fetch, Geocoder, Place, Precision } from '@nexgen-os/core';

export interface NominatimOptions {
  /**
   * Required by the public instance's usage policy: a user agent that names
   * the application. An installation running its own Nominatim may give
   * anything.
   */
  userAgent: string;
  /** Default: the public instance, one request per second. */
  baseUrl?: string;
  fetch?: Fetch;
}

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  address?: Record<string, string>;
  error?: string;
}

/** A geocoder on Nominatim. `source_code` is `nominatim`. */
export function nominatim(options: NominatimOptions): Geocoder {
  if (!options.userAgent || options.userAgent.trim() === '') {
    throw new Error('user_agent_required: Nominatim asks every client to name itself');
  }
  const base = trimSlash(options.baseUrl ?? 'https://nominatim.openstreetmap.org');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const headers = { 'User-Agent': options.userAgent };

  return {
    source_code: 'nominatim',
    async search(text, search = {}) {
      const params = new URLSearchParams({ q: text, format: 'jsonv2', addressdetails: '1', limit: String(search.limit ?? 5) });
      if (search.country) params.set('countrycodes', search.country.toLowerCase());
      if (search.language) params.set('accept-language', search.language);
      if (search.near) params.set('viewbox', viewbox(search.near));
      const rows = (await getJson(doFetch, `${base}/search?${params}`, headers)) as NominatimPlace[];
      return rows.map(fromNominatim).filter((p): p is Place => p !== null);
    },
    async reverse(lon, lat, search = {}) {
      const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1', zoom: '18' });
      if (search.language) params.set('accept-language', search.language);
      const row = (await getJson(doFetch, `${base}/reverse?${params}`, headers)) as NominatimPlace;
      return row.error ? null : fromNominatim(row);
    },
  };
}

function fromNominatim(row: NominatimPlace): Place | null {
  const a = row.address ?? {};
  const country = a.country_code?.toUpperCase();
  if (!country) return null;
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.path;
  const street = [road, a.house_number].filter(Boolean).join(' ') || null;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? null;
  const type = row.addresstype ?? '';
  const precision: Precision = a.house_number
    ? 'rooftop'
    : type === 'building' || type === 'house' || type === 'amenity' || type === 'shop' || type === 'office'
      ? 'rooftop'
      : type === 'road' || type === 'street' || road
        ? 'street'
        : type === 'postcode'
          ? 'postal_code'
          : type === 'state' || type === 'county' || type === 'region' || type === 'province'
            ? 'region'
            : 'city';
  const place: Place = {
    address: { street, address_extra: null, postal_code: a.postcode ?? null, city, region: isoRegion(a), country },
    lon: Number(row.lon),
    lat: Number(row.lat),
    precision,
    source_code: 'nominatim',
    label: row.display_name,
  };
  if (row.osm_type && row.osm_id !== undefined) place.external_id = { scheme: 'osm', value: `${row.osm_type}/${row.osm_id}` };
  return place;
}

/** The ISO 3166-2 code Nominatim gives per administrative level: the highest level present. */
function isoRegion(address: Record<string, string>): string | null {
  const levels = Object.keys(address)
    .map((key) => /^ISO3166-2-lvl(\d+)$/.exec(key))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((x, y) => x - y);
  return levels.length ? address[`ISO3166-2-lvl${levels[0]}`] : null;
}

function viewbox(near: { lon: number; lat: number }): string {
  const d = 0.1;
  return [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
}


async function getJson(doFetch: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
