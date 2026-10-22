// ICAR — the geocoding service of the Service public de Wallonie as a Geocoder
// of the core's shape. Open, no key.

import type { Fetch, Geocoder, Place, Precision } from '@nexgen-os/core';

interface Common {
  baseUrl?: string;
  fetch?: Fetch;
}

interface IcarPoint {
  type: 'Point';
  coordinates: [number, number];
}
interface IcarLevel {
  ident: string | number;
  name: string;
  geometry?: IcarPoint;
}
interface IcarCandidate {
  score: number;
  city?: IcarLevel;
  zone?: IcarLevel;
  street?: IcarLevel;
  house?: IcarLevel;
}
interface IcarAnswer {
  address?: { street?: unknown };
  candidates: IcarCandidate[];
}

/**
 * The Walloon address register. Its score reads per level: the units say
 * how the house number matched (1, 2, 8: exactly; 3 to 6: a neighbour or
 * the street), the tens the street, the hundreds the municipality (1, 8:
 * exactly; 2 to 4: a fuzzy name). It answers a search outside Wallonia
 * with a fuzzy municipality: a candidate that misses the street asked, or
 * stops at a fuzzy municipality, is dropped. It gives the NIS code. Its
 * reverse lookup scores by distance in metres, nearest first.
 */
export function icar(options: Common = {}): Geocoder {
  const base = trimSlash(options.baseUrl ?? 'https://geoservices.wallonie.be/geocodeWS');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  return {
    source_code: 'icar',
    async search(text, search = {}) {
      const params = new URLSearchParams({ address: text, crs: 'EPSG:4326' });
      const body = (await getJson(doFetch, `${base}/geocode?${params}`)) as IcarAnswer;
      const streetAsked = body.address?.street !== undefined;
      return body.candidates
        .filter((c) => (streetAsked ? c.street !== undefined : c.street !== undefined || [1, 8].includes(digit(c.score, 100))))
        .map((c) => fromIcar(c, matched(c)))
        .filter((p): p is Place => p !== null)
        .slice(0, search.limit ?? 5);
    },
    async reverse(lon, lat) {
      const params = new URLSearchParams({ x: String(lon), y: String(lat), distance: '100', geom: 'true', crs: 'EPSG:4326' });
      const body = (await getJson(doFetch, `${base}/revgeocode?${params}`)) as IcarAnswer;
      const nearest = body.candidates[0];
      return nearest ? fromIcar(nearest, nearest.house ? 'rooftop' : nearest.street ? 'street' : 'city') : null;
    },
  };
}

/** The precision a search candidate reaches, from its score. */
function matched(c: IcarCandidate): Precision {
  return c.house && [1, 2, 8].includes(digit(c.score, 1)) ? 'rooftop' : c.street ? 'street' : 'city';
}

function fromIcar(c: IcarCandidate, precision: Precision): Place | null {
  const point = c.house?.geometry ?? c.street?.geometry ?? c.city?.geometry;
  if (!point) return null;
  const street = [c.street?.name, precision === 'rooftop' ? c.house?.name : null].filter(Boolean).join(' ') || null;
  const postal = c.zone ? String(c.zone.ident) : null;
  const city = c.city?.name ?? null;
  const place: Place = {
    address: { address_line1: street, address_line2: null, postal_code: postal, city, region: 'BE-WAL', municipality_code: c.city ? String(c.city.ident) : null, country: 'BE' },
    lon: point.coordinates[0],
    lat: point.coordinates[1],
    precision,
    source_code: 'icar',
    label: [street, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
  if (precision === 'rooftop' && c.house) place.identifier = { scheme: 'icar_address', value: String(c.house.ident) };
  return place;
}

/** The digit of a score at one level: 1 for the house, 10 for the street, 100 for the municipality. */
function digit(score: number, level: 1 | 10 | 100): number {
  return Math.floor(Math.abs(score) / level) % 10;
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
