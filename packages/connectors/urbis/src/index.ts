// UrbIS — the Brussels address register (Paradigm geolocation service) as a Geocoder
// of the core's shape. Open, no key.

import type { Fetch, Geocoder, Place } from '@nexgen-os/core';

interface Common {
  baseUrl?: string;
  fetch?: Fetch;
}

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

async function getJson(doFetch: Fetch, url: string): Promise<unknown> {
  const response = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocoder_unavailable: ${response.status} from ${url}`);
  return response.json();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
