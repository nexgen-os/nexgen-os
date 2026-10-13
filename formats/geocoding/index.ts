// Addresses and positions, both ways, on any geocoder declared as a source.
//
// A form takes an address or a pair of coordinates and shows both; a site
// keeps the address in the fields every country has, the point, how precise
// the point is and who placed it (decision 0009). This library is the one
// way an application asks a geocoder: one interface, one adapter per
// geocoder. Nominatim and Photon (OpenStreetMap data, worldwide) ship here;
// a country pack adds its national address register, an installation adds a
// commercial geocoder with its own key.
//
// The library never touches the database. It returns places; what to do
// with them — write a site, offer a choice — is the caller's.

/** The postal address, in the fields every country has (schema.org PostalAddress). */
export interface Address {
  /** Street and number, as the country writes them. */
  street?: string | null;
  /** Building, floor, unit, box: the second line, when there is one. */
  address_extra?: string | null;
  postal_code?: string | null;
  city?: string | null;
  /** ISO 3166-2 subdivision when the geocoder knows it. */
  region?: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
}

/** How close a point is to the real place. The values of `sites.location_precision`. */
export type Precision = 'rooftop' | 'parcel' | 'street' | 'postal_code' | 'city' | 'region';

/** One place a geocoder answered with. */
export interface Place {
  address: Address;
  lon: number;
  lat: number;
  precision: Precision;
  /** The `sources.code` of the geocoder, so the site says who placed it. */
  source_code: string;
  /** What the geocoder calls it, for a list of candidates. */
  label: string;
  /** The identifier the geocoder knows the place by, in an `id_schemes` scheme. */
  external_id?: { scheme: string; value: string };
}

export interface SearchOptions {
  /** Restrict to one country, ISO 3166-1 alpha-2 (any case). */
  country?: string;
  /** Prefer places near this point. */
  near?: { lon: number; lat: number };
  /** At most this many places; the adapter's default otherwise. */
  limit?: number;
  /** Language of the labels, BCP 47 (`fr`, `pt-BR`). */
  language?: string;
}

export interface Geocoder {
  readonly source_code: string;
  /** Places matching a typed address or name, best first. Empty when none. */
  search(text: string, options?: SearchOptions): Promise<Place[]>;
  /** The address at a point, or null when the geocoder has none there. */
  reverse(lon: number, lat: number, options?: Pick<SearchOptions, 'language'>): Promise<Place | null>;
}

/** The subset of `fetch` the adapters use, so a test or a proxy can stand in. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * The columns of `sites` a place fills: the address, the point as GeoJSON,
 * the precision and the source. Spread it into an insert or an update.
 */
export function siteFields(place: Place) {
  return {
    street: place.address.street ?? null,
    address_extra: place.address.address_extra ?? null,
    postal_code: place.address.postal_code ?? null,
    city: place.address.city ?? null,
    region: place.address.region ?? null,
    country: place.address.country,
    geometry: { type: 'Point', coordinates: [place.lon, place.lat, 0] } as const,
    location_precision: place.precision,
    location_source_code: place.source_code,
  };
}

/**
 * The address as lines, in a plain order: street, extra line, postal code
 * and city, region, country. The exact layout a country prints is its
 * pack's; this is the one to show when no pack says otherwise.
 */
export function addressLines(address: Address): string[] {
  const postalCity = [address.postal_code, address.city].filter(Boolean).join(' ');
  return [address.street, address.address_extra, postalCity, address.region, address.country]
    .map((line) => (line ?? '').trim())
    .filter((line) => line !== '');
}

// ---------------------------------------------------------------------------
// Nominatim — https://nominatim.org, the OpenStreetMap geocoder.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Photon — https://github.com/komoot/photon, search as you type on OpenStreetMap.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

async function getJson(doFetch: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
