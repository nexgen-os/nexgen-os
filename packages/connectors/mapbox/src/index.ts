// Mapbox — https://www.mapbox.com, a commercial geocoder an installation pays
// for, as a connector, on the Geocoding API v6
// (https://docs.mapbox.com/api/search/geocoding/). Source `mapbox`, shipped
// with this package (`source.json`).
//
// In the chain of `geocoderFor()` it is the commercial service: asked after
// the register of the country and the open fallback found nothing. Its
// answers are kept only in the permanent mode its terms require for a
// result that is stored (`permanent=true`, the default here): a participant
// placed by it keeps the point.

import { readFileSync } from 'node:fs';
import type { Fetch, Geocoder, Place, Precision, SearchOptions, SourceRow } from '@nexgen-os/core';

export interface MapboxOptions {
  /** The access token, resolved by the caller from the `secret_ref` of the organisation's `connectors` row; never stored. */
  accessToken: string;
  /**
   * Permanent geocoding, the mode whose results may be stored (billed as
   * such). Default true: a place is kept. False only for a lookup shown and
   * thrown away.
   */
  permanent?: boolean;
  /** Default `https://api.mapbox.com`. */
  baseUrl?: string;
  fetch?: Fetch;
}

/** One feature of a v6 answer, the fields read here. */
interface MapboxFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    feature_type?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { longitude: number; latitude: number; accuracy?: string };
    context?: {
      address?: { address_number?: string; street_name?: string; name?: string };
      street?: { name?: string };
      postcode?: { name?: string };
      place?: { name?: string };
      locality?: { name?: string };
      region?: { name?: string; region_code?: string; region_code_full?: string };
      country?: { name?: string; country_code?: string };
    };
  };
}

export interface MapboxGeocoder extends Geocoder {
  /** The best place for an address typed in full (`autocomplete=false`), null when none. */
  forward(text: string, options?: SearchOptions): Promise<Place | null>;
}

/** A geocoder on Mapbox. `source_code` is `mapbox`. */
export function mapbox(options: MapboxOptions): MapboxGeocoder {
  if (!options?.accessToken) throw new Error('secret_not_found: mapbox needs the access token its connectors row names');
  const base = (options.baseUrl ?? 'https://api.mapbox.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const common = () => {
    const params = new URLSearchParams({ access_token: options.accessToken });
    if (options.permanent ?? true) params.set('permanent', 'true');
    return params;
  };
  const forward = async (text: string, search: SearchOptions, autocomplete: boolean, limit: number) => {
    const params = common();
    params.set('q', text);
    params.set('limit', String(limit));
    params.set('autocomplete', String(autocomplete));
    params.set('types', 'address,street,postcode,place,locality,region');
    if (search.country) params.set('country', search.country.toLowerCase());
    if (search.language) params.set('language', search.language);
    if (search.near) params.set('proximity', `${search.near.lon},${search.near.lat}`);
    const body = (await getJson(doFetch, `${base}/search/geocode/v6/forward?${params}`)) as { features?: MapboxFeature[] };
    return (body.features ?? []).map(fromMapbox).filter((p): p is Place => p !== null);
  };

  return {
    source_code: 'mapbox',
    async search(text, search = {}) {
      return forward(text, search, true, search.limit ?? 5);
    },
    async forward(text, search = {}) {
      return (await forward(text, search, false, 1))[0] ?? null;
    },
    async reverse(lon, lat, search = {}) {
      const params = common();
      params.set('longitude', String(lon));
      params.set('latitude', String(lat));
      params.set('types', 'address');
      params.set('limit', '1');
      if (search.language) params.set('language', search.language);
      const body = (await getJson(doFetch, `${base}/search/geocode/v6/reverse?${params}`)) as { features?: MapboxFeature[] };
      const first = body.features?.[0];
      return first ? fromMapbox(first) : null;
    },
  };
}

/** The `sources` row this package ships (`source.json`): write it with `registerSource()` of the core. */
export const mapboxSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;

function fromMapbox(feature: MapboxFeature): Place | null {
  const p = feature.properties;
  const c = p.context ?? {};
  const country = c.country?.country_code?.toUpperCase();
  if (!country) return null;
  const street = c.address?.name
    ?? ([c.address?.address_number, c.address?.street_name].filter(Boolean).join(' ') || null)
    ?? null;
  const line1 = street ?? (p.feature_type === 'street' ? (p.name ?? null) : (c.street?.name ?? null));
  const [lon, lat] = p.coordinates ? [p.coordinates.longitude, p.coordinates.latitude] : feature.geometry.coordinates;
  const place: Place = {
    address: {
      address_line1: line1,
      address_line2: null,
      postal_code: c.postcode?.name ?? null,
      city: c.place?.name ?? c.locality?.name ?? null,
      region: c.region?.region_code_full ?? null,
      // Mapbox does not publish the country's own municipality code.
      municipality_code: null,
      country,
    },
    lon,
    lat,
    precision: precisionOf(p.feature_type, p.coordinates?.accuracy),
    source_code: 'mapbox',
    label: p.full_address ?? [p.name, p.place_formatted].filter(Boolean).join(', '),
  };
  return place;
}

/** How close the point is: the accuracy of an address point, else the kind of the feature. */
function precisionOf(type: string | undefined, accuracy: string | undefined): Precision {
  if (type === 'address') {
    if (accuracy === 'rooftop' || accuracy === 'point') return 'rooftop';
    if (accuracy === 'parcel') return 'parcel';
    return 'street';
  }
  if (type === 'street') return 'street';
  if (type === 'postcode') return 'postal_code';
  if (type === 'region' || type === 'country') return 'region';
  return 'city';
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  // The token travels in the query: never in a message.
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url.replace(/access_token=[^&]*/, 'access_token=…')}`);
  return response.json();
}
