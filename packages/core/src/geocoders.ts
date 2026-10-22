/**
 * The geocoder chain a surface uses, from the connectors the person named.
 *
 * Finding an address sends it to a service, so only the geocoders the
 * person listed are asked (`NEXGEN_GEOCODERS=ban,photon`). Which country or
 * region each one serves is not code: it is the `countries` and `regions`
 * of its row in `sources`, which the packs bring. A geocoder with neither is
 * worldwide: the open fallback is the first whose source may be passed on
 * (`redistributable`), the installation's commercial one the first whose
 * source may not (Mapbox), whatever the order they are named in.
 * `geocoderFor()` then asks the register of the country first, the open
 * fallback next, the commercial one last.
 */
import type { Db } from './db.js';
import { geocoderFor, type Geocoder } from './address.js';
import { GestureError } from './refusal.js';

/** The variables a surface reads its geocoders from. */
export const GEOCODER_ENV = {
  geocoders: 'NEXGEN_GEOCODERS',
  userAgent: 'NEXGEN_GEOCODER_USER_AGENT',
  languages: 'NEXGEN_GEOCODER_LANGUAGES',
} as const;

/** The connectors named in the environment, in order; none when the person named none. */
export function geocoderNames(env: NodeJS.ProcessEnv): string[] {
  const names = (env[GEOCODER_ENV.geocoders] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new GestureError(`bad_geocoder: ${name} is not the name of a connector`);
  }
  return names;
}

/**
 * Loads each connector by its package (`@nexgen-os/<name>`), installed beside
 * the surface, and builds it with what the environment gives: the user agent
 * a public instance asks for, the languages a register is asked in.
 */
export async function loadGeocoders(names: string[], env: NodeJS.ProcessEnv): Promise<Record<string, Geocoder>> {
  const options = {
    ...(env[GEOCODER_ENV.userAgent] ? { userAgent: env[GEOCODER_ENV.userAgent] } : {}),
    languages: (env[GEOCODER_ENV.languages] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  const loaded: Record<string, Geocoder> = {};
  for (const name of names) {
    const specifier = `@nexgen-os/${name}`;
    const module = (await import(specifier).catch(() => {
      throw new GestureError(`geocoder_not_installed: install ${specifier} beside this surface to use it`);
    })) as Record<string, unknown>;
    const factory = module[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
    if (typeof factory !== 'function') throw new GestureError(`bad_geocoder: ${specifier} exports no geocoder named ${name}`);
    loaded[name] = (factory as (o: unknown) => Geocoder)(options);
  }
  return loaded;
}

/** The chain of the geocoders given, keyed by the countries and regions their sources serve. */
export async function geocoderChain(db: Db, geocoders: Record<string, Geocoder>): Promise<Geocoder | undefined> {
  const codes = Object.keys(geocoders);
  if (codes.length === 0) return undefined;
  const { rows } = await db.query<{ code: string; places: string[]; redistributable: boolean }>(
    `select code, coalesce(regions, '{}') || coalesce(countries, '{}') as places, redistributable from sources where code = any($1)`, [codes]);
  const served = new Map(rows.map((r) => [r.code, r]));
  const national: Record<string, Geocoder> = {};
  const open: Geocoder[] = [];
  const paid: Geocoder[] = [];
  for (const code of codes) {
    const row = served.get(code);
    const places = row?.places ?? [];
    if (places.length === 0) (row?.redistributable === false ? paid : open).push(geocoders[code]!);
    for (const place of places) national[place.toUpperCase()] ??= geocoders[code]!;
  }
  // Two open ones and no paid one: the second stands where the commercial one would.
  const fallback = open[0] ?? paid[0];
  const commercial = open[0] ? (paid[0] ?? open[1]) : paid[1];
  if (fallback === undefined) {
    // Registers only: a search outside the places they serve finds nothing.
    return geocoderFor({ national, fallback: { source_code: 'none', search: async () => [], reverse: async () => null } });
  }
  return geocoderFor({ national, fallback, ...(commercial ? { commercial } : {}) });
}
