// The standard shape of a place, and the one interface of a geocoder.
//
// A form takes an address or a pair of coordinates and shows both; a
// participant keeps the address in the fields every country has, the point, how precise
// the point is and who placed it (decision 0009). Every geocoder is a
// connector (`@nexgen-os/nominatim`, `photon`, `ban`, `geopunt`, `urbis`,
// `icar`…) that answers in this shape, and `geocoderFor()` chains them: the
// country's register first, then the open fallback, then a commercial
// service the installation pays for.
//
// Nothing here touches the database. A geocoder returns places; what to do
// with them — place a participant, offer a choice — is the caller's.

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
  /** The municipality in the country's own code (INSEE, NIS, CBS) when the geocoder gives it. */
  municipality_code?: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
}

/** How close a point is to the real place. The values of `participants.location_precision`. */
export type Precision = 'rooftop' | 'parcel' | 'street' | 'postal_code' | 'city' | 'region';

/** One place a geocoder answered with. */
export interface Place {
  address: Address;
  lon: number;
  lat: number;
  precision: Precision;
  /** The `sources.code` of the geocoder, so the participant says who placed it. */
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
 * The place columns of `participants` a place fills: the address, the
 * point as GeoJSON, the precision and the source. Spread it into an insert
 * or an update. The municipality code is not a column: it is an identifier
 * of the participant under
 * the scheme its country's pack publishes.
 */
export function placeFields(place: Place) {
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
// Choosing a geocoder: the country's register first, then the open fallback,
// then whatever commercial service the installation pays for.
// ---------------------------------------------------------------------------

export interface GeocoderChoice {
  /**
   * The address registers packs bring, keyed by country (`FR`) or by region
   * (`BE-VLG`, `BE-BRU`, `BE-WAL`) when a country keeps one per region. A
   * search in a country asks its country-wide register, then each regional
   * one in the order given, until one answers.
   */
  national?: Record<string, Geocoder>;
  /** Worldwide and open: Nominatim or Photon. */
  fallback: Geocoder;
  /** The installation's own commercial geocoder, when it has one and the others found nothing. */
  commercial?: Geocoder;
}

/**
 * One geocoder that asks the national register of the country (when the
 * search names one and a pack brought it), then the open fallback, then the
 * commercial service, stopping at the first that answers. The source code
 * of each place says which one did.
 */
export function geocoderFor(choice: GeocoderChoice): Geocoder {
  const chain = (country?: string): Geocoder[] => {
    const cc = country?.toUpperCase();
    const national = cc
      ? Object.entries(choice.national ?? {})
          .filter(([key]) => key === cc || key.startsWith(`${cc}-`))
          .sort(([a], [b]) => a.length - b.length)
          .map(([, g]) => g)
      : [];
    return [...national, choice.fallback, choice.commercial].filter((g): g is Geocoder => g !== undefined);
  };
  return {
    source_code: 'chain',
    async search(text, options = {}) {
      for (const g of chain(options.country)) {
        const places = await g.search(text, options);
        if (places.length) return places;
      }
      return [];
    },
    async reverse(lon, lat, options = {}) {
      for (const g of [...new Set([...Object.values(choice.national ?? {}), choice.fallback, ...(choice.commercial ? [choice.commercial] : [])])]) {
        const place = await g.reverse(lon, lat, options);
        if (place) return place;
      }
      return null;
    },
  };
}
