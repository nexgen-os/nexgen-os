// Base Adresse Nationale — https://adresse.data.gouv.fr, the French address
// register, as a Geocoder of the core's shape. Open (Licence Ouverte 2.0),
// no key, house-number precision, search as you type. The `fr` pack names
// the register as a source (`ban`); the adapter lives here with the other
// geocoders, as code never belongs in a pack.

import type { Fetch, Geocoder, Place, Precision } from '@nexgen-os/core';

export const SOURCE_CODE = 'ban';

interface BanFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    id?: string;
    label: string;
    type: 'housenumber' | 'street' | 'locality' | 'municipality';
    housenumber?: string;
    street?: string;
    name?: string;
    postcode?: string;
    city?: string;
    citycode?: string;
    context?: string;
    score?: number;
  };
}

// Paris is one territorial collectivity, `FR-75C` in ISO 3166-2, where its
// context reads the department code `75`.
const SUBDIVISION: Record<string, string> = { '75': '75C' };

const PRECISION: Record<BanFeature['properties']['type'], Precision> = {
  housenumber: 'rooftop',
  street: 'street',
  locality: 'city',
  municipality: 'city',
};

export function ban(options: { baseUrl?: string; fetch?: Fetch } = {}): Geocoder {
  const base = (options.baseUrl ?? 'https://api-adresse.data.gouv.fr').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);

  return {
    source_code: SOURCE_CODE,
    async search(text, search = {}) {
      const params = new URLSearchParams({ q: text, limit: String(search.limit ?? 5), autocomplete: '1' });
      if (search.near) {
        params.set('lat', String(search.near.lat));
        params.set('lon', String(search.near.lon));
      }
      const body = (await getJson(doFetch, `${base}/search/?${params}`)) as { features: BanFeature[] };
      return body.features.map(fromBan);
    },
    async reverse(lon, lat) {
      const body = (await getJson(doFetch, `${base}/reverse/?lon=${lon}&lat=${lat}`)) as { features: BanFeature[] };
      return body.features[0] ? fromBan(body.features[0]) : null;
    },
  };
}

function fromBan(f: BanFeature): Place {
  const p = f.properties;
  const street = [p.street ?? (p.type === 'street' ? p.name : undefined), p.housenumber].filter(Boolean).join(' ') || null;
  // The context reads "<department code>, <department>, <region>": the department code is the ISO 3166-2 subdivision.
  const department = p.context?.split(',')[0]?.trim();
  const place: Place = {
    address: { address_line1: street, address_line2: null, postal_code: p.postcode ?? null, city: p.city ?? null, region: department ? `FR-${SUBDIVISION[department] ?? department}` : null, municipality_code: p.citycode ?? null, country: 'FR' },
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    precision: PRECISION[p.type] ?? 'city',
    source_code: SOURCE_CODE,
    label: p.label,
  };
  if (p.id) place.identifier = { scheme: 'ban_address', value: p.id };
  return place;
}

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}
