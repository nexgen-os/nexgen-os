// The standard shape of a place, and the one interface of a geocoder.
//
// A form takes an address or a pair of coordinates and shows both; a
// participant keeps the address in the fields every country has, the point, how precise
// the point is and who placed it (decision 0009). Every geocoder is a
// connector (`@nexgen-os/nominatim`, `photon`, `ban`, `geopunt`, `urbis`,
// `icar`, `mapbox`…) that answers in this shape, and `geocoderFor()` chains
// them: the country's register first, then the open fallback, then a
// commercial service the installation pays for (`mapbox`).
//
// Nothing here touches the database. A geocoder returns places; what to do
// with them — place a participant, offer a choice — is the caller's.

// The shape of a place and the interface of a geocoder live in
// `@nexgen-os/connector`, MIT, so that a geocoder runs without the core
// (decision 0064); the core re-exports them, one definition for both.
import type { Address, Geocoder, Place } from '@nexgen-os/connector';
export type { Address, Fetch, Geocoder, Place, Precision, SearchOptions } from '@nexgen-os/connector';

/**
 * The place columns of `participants` a place fills: the address, the
 * municipality in its country's own code, the point as GeoJSON, the
 * precision and the source. Spread it into an insert or an update.
 */
export function placeFields(place: Place) {
  return {
    address_line1: place.address.address_line1 ?? null,
    address_line2: place.address.address_line2 ?? null,
    postal_code: place.address.postal_code ?? null,
    city: place.address.city ?? null,
    region: place.address.region ?? null,
    municipality: place.address.municipality_code ?? null,
    country: place.address.country,
    geometry: { type: 'Point', coordinates: [place.lon, place.lat, 0] } as const,
    location_precision: place.precision,
    location_source_code: place.source_code,
  };
}

/**
 * The address as lines, in a plain order: first line, second line, postal code
 * and city, region, country. The exact layout a country prints is its
 * pack's; this is the one to show when no pack says otherwise.
 */
export function addressLines(address: Address): string[] {
  const postalCity = [address.postal_code, address.city].filter(Boolean).join(' ');
  return [address.address_line1, address.address_line2, postalCity, address.region, address.country]
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
