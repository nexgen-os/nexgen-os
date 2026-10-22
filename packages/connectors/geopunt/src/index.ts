// Geopunt — the Flemish address register as a Geocoder of the core's shape.
// Open, no key.

import type { Fetch, Geocoder, Place, Precision } from '@nexgen-os/core';

interface Common {
  baseUrl?: string;
  fetch?: Fetch;
}

interface GeopuntLocation {
  Municipality: string | null;
  Zipcode: string | null;
  Thoroughfarename: string | null;
  Housenumber: string | null;
  ID: number | null;
  FormattedAddress: string;
  Location: { Lat_WGS84: number; Lon_WGS84: number };
  LocationType: string;
}

/**
 * The Flemish address register. Its matching is loose on house numbers (it
 * answers `Korenmarkt 10` for `Korenmarkt 1`): a place whose number is not
 * one typed in the search keeps the street only, at precision `street`.
 * It does not give the NIS code of the municipality.
 */
export function geopunt(options: Common = {}): Geocoder {
  const base = trimSlash(options.baseUrl ?? 'https://geo.api.vlaanderen.be/geolocation');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  return {
    source_code: 'geopunt',
    async search(text, search = {}) {
      const params = new URLSearchParams({ q: text, c: String(search.limit ?? 5) });
      const body = (await getJson(doFetch, `${base}/v4/Location?${params}`)) as { LocationResult: GeopuntLocation[] };
      const typed = new Set(text.toLowerCase().split(/[\s,]+/));
      return body.LocationResult.map((l) => fromGeopunt(l, typed));
    },
    async reverse(lon, lat) {
      const body = (await getJson(doFetch, `${base}/v4/Location?latlon=${lat},${lon}&c=1`)) as { LocationResult: GeopuntLocation[] };
      return body.LocationResult[0] ? fromGeopunt(body.LocationResult[0]) : null;
    },
  };
}

function fromGeopunt(l: GeopuntLocation, typed?: Set<string>): Place {
  const type = l.LocationType;
  // A house number the search did not ask for is the register's guess, not the place.
  const numberAsked = !l.Housenumber || !typed || typed.has(l.Housenumber.toLowerCase());
  let precision: Precision = type.includes('gemeente')
    ? 'city'
    : type.endsWith('straat') || type.includes('geïnterpoleerd')
      ? 'street'
      : type === 'perceel'
        ? 'parcel'
        : l.Housenumber
          ? 'rooftop'
          : 'city';
  if (!numberAsked && precision === 'rooftop') precision = 'street';
  const street = [l.Thoroughfarename, numberAsked ? l.Housenumber : null].filter(Boolean).join(' ') || null;
  const region = type.startsWith('urbis') ? 'BE-BRU' : 'BE-VLG';
  const place: Place = {
    address: { address_line1: street, address_line2: null, postal_code: l.Zipcode, city: l.Municipality, region, municipality_code: null, country: 'BE' },
    lon: l.Location.Lon_WGS84,
    lat: l.Location.Lat_WGS84,
    precision,
    source_code: 'geopunt',
    label: numberAsked ? l.FormattedAddress : [street, [l.Zipcode, l.Municipality].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
  // The ID of a Flemish house number is its identifier in the address register.
  if (region === 'BE-VLG' && precision === 'rooftop' && l.ID !== null) place.identifier = { scheme: 'vlaanderen_address', value: String(l.ID) };
  return place;
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
