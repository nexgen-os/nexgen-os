// The standard shape of a place and the one interface of a geocoder: what
// every geocoder answers in (decision 0009). A participant keeps the address
// in the fields every country has, the point, how precise the point is and
// who placed it; `geocoderFor()` of the core chains the geocoders.

/** The postal address, in the fields every country has (schema.org PostalAddress). */
export interface Address {
  /** Street and number, as the country writes them. */
  address_line1?: string | null;
  /** Building, floor, unit, box: the second line, when there is one. */
  address_line2?: string | null;
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
  /** The identifier the geocoder knows the place by, in an `identifier_schemes` scheme. */
  identifier?: { scheme: string; value: string };
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
