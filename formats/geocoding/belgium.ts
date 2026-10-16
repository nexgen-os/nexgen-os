// The Belgian address registers as Geocoders of the core's shape. Belgium
// keeps one register per region, so there is one adapter per register:
//
//   geopunt()  Flanders — the Geolocation API of Digitaal Vlaanderen on the
//              Flemish base registers, which also serves the Brussels UrbIS
//              addresses (region BE-BRU on those answers)
//   urbis()    Brussels — the UrbIS geolocation service of Paradigm
//   walloon()  Wallonia — the ICAR geocoding service of the Service public
//              de Wallonie
//
// All three are open and need no key. The `be` pack names the registers as
// sources; the adapters live here with the other geocoders, as code never
// belongs in a pack. `belgium()` gives them to
// `geocoderFor` keyed by region, in the order a search should try them.

import type { Fetch, Geocoder, Place, Precision } from './index.js';

interface Common {
  baseUrl?: string;
  fetch?: Fetch;
}

// ---------------------------------------------------------------------------
// Geopunt — https://geo.api.vlaanderen.be/geolocation/
// ---------------------------------------------------------------------------

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
    address: { street, address_extra: null, postal_code: l.Zipcode, city: l.Municipality, region, municipality_code: null, country: 'BE' },
    lon: l.Location.Lon_WGS84,
    lat: l.Location.Lat_WGS84,
    precision,
    source_code: 'geopunt',
    label: numberAsked ? l.FormattedAddress : [street, [l.Zipcode, l.Municipality].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
  // The ID of a Flemish house number is its identifier in the address register.
  if (region === 'BE-VLG' && precision === 'rooftop' && l.ID !== null) place.external_id = { scheme: 'vlaanderen_address', value: String(l.ID) };
  return place;
}

// ---------------------------------------------------------------------------
// UrbIS — https://geoservices.irisnet.be/localization/
// ---------------------------------------------------------------------------

interface UrbisAddress {
  address: { street: { name: string; postCode: string; municipality: string; id: string }; number: string };
  point: { x: number; y: number };
  qualificationCode: { policeNumber: string; postCode: string; municipality: string; streetName: string };
}

export interface UrbisOptions extends Common {
  /**
   * The languages the register is asked in, in turn: it only matches a
   * street name written in the language of the request. The search's own
   * language goes first when it is one of them.
   */
  languages: string[];
}

/**
 * The Brussels address register. It answers every query, inside Brussels
 * or not, with the nearest name it has: only places whose street name it
 * found are kept, so a search elsewhere returns nothing and the chain moves
 * on. Its reverse lookup takes Belgian Lambert 72 only, so `reverse` answers
 * null; Geopunt answers reverse lookups in Brussels.
 */
export function urbis(options: UrbisOptions): Geocoder {
  if (!options.languages?.length) throw new Error('languages_required: UrbIS matches street names in the language it is asked in');
  const base = trimSlash(options.baseUrl ?? 'https://geoservices.irisnet.be/localization');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  return {
    source_code: 'urbis',
    async search(text, search = {}) {
      const wanted = search.language?.slice(0, 2).toLowerCase();
      const languages = wanted && options.languages.includes(wanted) ? [wanted, ...options.languages.filter((l) => l !== wanted)] : options.languages;
      for (const language of languages) {
        const params = new URLSearchParams({ language, spatialReference: '4326', address: text });
        const body = (await getJson(doFetch, `${base}/Rest/Localize/getaddresses?${params}`)) as { result?: UrbisAddress[] };
        const places = (body.result ?? []).filter((r) => r.qualificationCode.streetName === '1').map(fromUrbis);
        if (places.length) return places.slice(0, search.limit ?? 5);
      }
      return [];
    },
    async reverse() {
      return null;
    },
  };
}

function fromUrbis(r: UrbisAddress): Place {
  const s = r.address.street;
  const found = r.qualificationCode.policeNumber === '1';
  const street = [s.name, found ? r.address.number : null].filter(Boolean).join(' ');
  return {
    address: { street, address_extra: null, postal_code: s.postCode, city: s.municipality, region: 'BE-BRU', municipality_code: null, country: 'BE' },
    lon: r.point.x,
    lat: r.point.y,
    // An interpolated or missing number is placed on the street.
    precision: found ? 'rooftop' : 'street',
    source_code: 'urbis',
    label: `${street}, ${s.postCode} ${s.municipality}`,
  };
}

// ---------------------------------------------------------------------------
// ICAR — https://geoservices.wallonie.be/geocodeWS/
// ---------------------------------------------------------------------------

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
export function walloon(options: Common = {}): Geocoder {
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
    address: { street, address_extra: null, postal_code: postal, city, region: 'BE-WAL', municipality_code: c.city ? String(c.city.ident) : null, country: 'BE' },
    lon: point.coordinates[0],
    lat: point.coordinates[1],
    precision,
    source_code: 'icar',
    label: [street, [postal, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
  if (precision === 'rooftop' && c.house) place.external_id = { scheme: 'icar_address', value: String(c.house.ident) };
  return place;
}

/** The digit of a score at one level: 1 for the house, 10 for the street, 100 for the municipality. */
function digit(score: number, level: 1 | 10 | 100): number {
  return Math.floor(Math.abs(score) / level) % 10;
}

// ---------------------------------------------------------------------------

/**
 * The three registers keyed by region for `geocoderFor`, in the order a
 * search tries them: Brussels first (UrbIS keeps only what it finds in
 * Brussels), Flanders next (Geopunt finds nothing in Wallonia), Wallonia
 * last (ICAR guesses a municipality for anything it does not know).
 */
export function belgium(options: { fetch?: Fetch } = {}): Record<'BE-BRU' | 'BE-VLG' | 'BE-WAL', Geocoder> {
  return {
    'BE-BRU': urbis({ fetch: options.fetch, languages: ['fr', 'nl'] }),
    'BE-VLG': geopunt({ fetch: options.fetch }),
    'BE-WAL': walloon({ fetch: options.fetch }),
  };
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
