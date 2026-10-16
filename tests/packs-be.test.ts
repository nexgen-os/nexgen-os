// The Belgian pack: its rows load on the core with the three regions said,
// the task templates of a roof installation and of an energy community give
// a project those of the region of its sites, each regional register answers as a geocoder of the core's shape on a
// recorded answer, and the chain asks Brussels, Flanders and Wallonia in
// turn before the open fallback.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderFor, type Fetch, type Geocoder, type Place } from '../formats/geocoding/index.js';
import { belgium, geopunt, urbis, walloon } from '../formats/geocoding/belgium.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot } from './helpers/db.js';

const recorded = async (name: string) => JSON.parse(await readFile(`${repoRoot}/tests/fixtures/${name}`, 'utf8')) as unknown;
/** Answers each URL with the first recorded body whose key it contains; an empty answer otherwise. */
const fetchBy = (routes: Record<string, unknown>, empty: unknown = {}) => {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([key]) => url.includes(key));
    return { ok: true, status: 200, json: async () => (hit ? hit[1] : empty) };
  };
  return { fetch, calls };
};
const stub = (code: string, places: Place[]): Geocoder => ({
  source_code: code,
  search: async () => places,
  reverse: async () => places[0] ?? null,
});
const somewhere = (code: string): Place => ({ address: { country: 'BE' }, lon: 0, lat: 0, precision: 'city', source_code: code, label: code });

let db: PGlite;
let geopuntKorenmarkt: unknown;
let urbisWetstraat: unknown;
let urbisElsewhere: unknown;
let icarLiege: unknown;
let icarElsewhere: unknown;
let icarReverse: unknown;

beforeAll(async () => {
  db = await freshDatabase(['tasks'], ['be']);
  geopuntKorenmarkt = await recorded('geopunt-location-korenmarkt-1-gent.json');
  urbisWetstraat = await recorded('urbis-getaddresses-nl-wetstraat-16.json');
  urbisElsewhere = await recorded('urbis-getaddresses-fr-korenmarkt-1-gent.json');
  icarLiege = await recorded('icar-geocode-saint-lambert-18-liege.json');
  icarElsewhere = await recorded('icar-geocode-korenmarkt-1-gent.json');
  icarReverse = await recorded('icar-revgeocode-saint-lambert-liege.json');
});

afterAll(async () => {
  await db.close();
});

describe('the be pack', () => {
  it('brings its sources, each regional one saying its region', async () => {
    const rows = await db.query<{ code: string; regions: string[] }>(`select code, regions from sources where published_by = 'pack:be' order by code`);
    expect(Object.fromEntries(rows.rows.map((r) => [r.code, r.regions]))).toEqual({
      basisregisters_vlaanderen: ['BE-VLG'],
      geopunt: ['BE-VLG', 'BE-BRU'],
      icar: ['BE-WAL'],
      rmi_aws: [],
      urbis: ['BE-BRU'],
    });
    const countries = await one<{ n: number }>(db, `select count(*)::int n from sources where published_by = 'pack:be' and countries <> '{BE}'`);
    expect(countries.n).toBe(0);
  });

  it('reads a Belgian EAN on the core GSRN scheme, and checks the NIS code', async () => {
    const schemes = await db.query<{ code: string }>(`select code from id_schemes where published_by = 'pack:be' order by code`);
    expect(schemes.rows.map((r) => r.code)).toEqual(['icar_address', 'nis', 'urbis_building', 'vlaanderen_address', 'vlaanderen_building']);
    const org = await organisation(db, 'Een gemeente', USER_A);
    const site = await insert(db, 'sites', { organisation_id: org, name: 'Stadhuis', country: 'BE', region: 'BE-VLG', municipality_code: '44021' });
    expect(await insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '541448820000000017', scheme: 'gs1_gsrn' })).toBeTruthy();
    await expect(insert(db, 'meters', { organisation_id: org, site_id: site, identifier: '54144882000000001', scheme: 'gs1_gsrn' })).rejects.toThrow(/invalid_identifier/);
    const nis = await db.query<{ value: string; ok: boolean }>(
      `select v as value, v ~ (select pattern from id_schemes where code = 'nis') as ok from unnest(array['44021', '21004', '62063', '4402', '440210']) v`,
    );
    expect(nis.rows.map((r) => r.ok)).toEqual([true, true, true, false, false]);
  });
});

interface Plan {
  created: number;
  existing: number;
  skipped: { code: string; reason: string; regions?: string[] }[];
}

describe('the tasks of the be pack', () => {
  const plan = async (project: string) => (await asUser(db, USER_A, () => one<{ p: Plan }>(db, 'select tasks.plan($1) p', [project]))).p;
  const codes = async (project: string) =>
    (await db.query<{ code: string }>(`select tp.code from tasks.tasks t join tasks.templates tp on tp.id = t.template_id where t.subject_id = $1 order by tp.position, tp.code`, [project])).rows.map((r) => r.code);
  const projectOn = async (org: string, kind: string, region: string | null) => {
    const project = await insert(db, 'projects', { organisation_id: org, name: `A ${kind} project`, country: 'BE', kind, status: 'creation' });
    if (region) {
      const site = await insert(db, 'sites', { organisation_id: org, name: `A site in ${region}`, country: 'BE', region });
      await insert(db, 'participants', { organisation_id: org, project_id: project, site_id: site, name: 'The site', role: 'prosumer' });
    }
    return project;
  };

  it('answers texts of the pack only, each regional template in a region of Belgium', async () => {
    const unknown = await db.query(`select code from tasks.templates where published_by = 'pack:be' and legal_source_code is not null and legal_source_code not in (select code from legal_sources where published_by = 'pack:be')`);
    expect(unknown.rows).toEqual([]);
    const orphans = await db.query(`select code from legal_sources where published_by = 'pack:be' and code not in (select legal_source_code from tasks.templates where legal_source_code is not null)`);
    expect(orphans.rows).toEqual([]);
    const regions = await db.query<{ region: string }>(`select distinct unnest(regions) region from tasks.templates where published_by = 'pack:be' order by 1`);
    expect(regions.rows.map((r) => r.region)).toEqual(['BE-BRU', 'BE-VLG', 'BE-WAL']);
  });

  it('plans a Walloon roof installation with the Walloon permit and the federal inspection', async () => {
    const org = await organisation(db, 'Une commune wallonne', USER_A);
    const roof = await projectOn(org, 'pv_roof', 'BE-WAL');
    expect(await plan(roof)).toMatchObject({ created: 9, skipped: [] });
    expect(await codes(roof)).toEqual([
      'pv_roof_feasibility', 'pv_roof_design', 'pv_roof_permit_wal', 'pv_roof_grid_notification', 'pv_roof_procurement',
      'pv_roof_installation', 'pv_roof_conformity', 'pv_roof_operator_registered', 'pv_roof_handover',
    ]);
    const permit = await one<{ legal_reference: string; depends: string }>(db,
      `select tp.legal_reference, d.name depends from tasks.tasks t join tasks.templates tp on tp.id = t.template_id left join tasks.tasks d on d.id = t.depends_on where t.subject_id = $1 and tp.code = 'pv_roof_permit_wal'`, [roof]);
    expect(permit).toEqual({ legal_reference: 'R.IV.1-1', depends: 'Feasibility study: yield, self-consumption share, budget' });
  });

  it('says which regional tasks it could not decide when no site of the project says its region', async () => {
    const org = await organisation(db, 'Een coöperatie', USER_A);
    const roof = await projectOn(org, 'pv_roof', null);
    const first = await plan(roof);
    expect(first.created).toBe(8);
    expect(first.skipped.map((s) => [s.code, s.reason, s.regions])).toEqual([
      ['pv_roof_permit_bru', 'region_missing', ['BE-BRU']],
      ['pv_roof_permit_vlg', 'region_missing', ['BE-VLG']],
      ['pv_roof_permit_wal', 'region_missing', ['BE-WAL']],
    ]);
    const site = await insert(db, 'sites', { organisation_id: org, name: 'Loods', country: 'BE', region: 'BE-VLG' });
    await insert(db, 'participants', { organisation_id: org, project_id: roof, site_id: site, name: 'Loods', role: 'producer' });
    expect(await plan(roof)).toMatchObject({ created: 1, existing: 8, skipped: [] });
    expect(await codes(roof)).toContain('pv_roof_permit_vlg');
  });

  it('plans a Brussels energy community with the authorisation of its regulator', async () => {
    const org = await organisation(db, 'Une communauté bruxelloise', USER_A);
    const community = await projectOn(org, 'energy_community', 'BE-BRU');
    expect(await plan(community)).toMatchObject({ created: 6, skipped: [] });
    expect(await codes(community)).toEqual([
      'ec_perimeter_check', 'ec_bru_legal_entity', 'ec_bru_authorisation', 'ec_participant_consents', 'ec_bru_operator_registered', 'ec_monthly_settlement',
    ]);
    const authorisation = await one<{ role: string; legal_reference: string }>(db,
      `select t.role, tp.legal_reference from tasks.tasks t join tasks.templates tp on tp.id = t.template_id where t.subject_id = $1 and tp.code = 'ec_bru_authorisation'`, [community]);
    expect(authorisation).toEqual({ role: 'regulator', legal_reference: 'Article 28sexiesdecies' });
  });
});

describe('Geopunt, the Flemish register', () => {
  it('keeps the street only when the house number it matched is not the one asked', async () => {
    const { fetch, calls } = fetchBy({ 'geo.api.vlaanderen.be': geopuntKorenmarkt });
    const places = await geopunt({ fetch }).search('Korenmarkt 1, 9000 Gent');
    expect(calls[0]).toContain('/geolocation/v4/Location?q=Korenmarkt+1%2C+9000+Gent');
    // The register answered Korenmarkt 10, 11 and 12 for Korenmarkt 1.
    expect(places[0]).toMatchObject({
      address: { street: 'Korenmarkt', postal_code: '9000', city: 'Gent', region: 'BE-VLG', municipality_code: null, country: 'BE' },
      precision: 'street',
      source_code: 'geopunt',
      label: 'Korenmarkt, 9000 Gent',
    });
    expect(places[0].external_id).toBeUndefined();
    expect(places.every((p) => p.precision === 'street')).toBe(true);
  });

  it('places a house number asked at the rooftop, with its address identifier', async () => {
    const { fetch } = fetchBy({ 'geo.api.vlaanderen.be': geopuntKorenmarkt });
    const [first] = await geopunt({ fetch }).search('Korenmarkt 10 Gent');
    expect(first).toMatchObject({
      address: { street: 'Korenmarkt 10', region: 'BE-VLG' },
      precision: 'rooftop',
      label: 'Korenmarkt 10, 9000 Gent',
      external_id: { scheme: 'vlaanderen_address', value: '602422' },
    });
    expect(first.lon).toBeCloseTo(3.72231, 5);
    expect(first.lat).toBeCloseTo(51.05458, 5);
  });
});

describe('UrbIS, the Brussels register', () => {
  it('asks in each language until a street name is found, at the house number', async () => {
    const { fetch, calls } = fetchBy({ 'language=nl': urbisWetstraat, 'language=fr': urbisElsewhere });
    const places = await urbis({ fetch, languages: ['fr', 'nl'] }).search('Wetstraat 16 1000 Brussel');
    expect(calls.map((u) => new URL(u).searchParams.get('language'))).toEqual(['fr', 'nl']);
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      address: { street: 'Wetstraat 16', postal_code: '1000', city: 'Brussel', region: 'BE-BRU', municipality_code: null, country: 'BE' },
      precision: 'rooftop',
      source_code: 'urbis',
    });
  });

  it('asks the search language first, and keeps nothing it did not find in Brussels', async () => {
    const { fetch, calls } = fetchBy({ 'language=nl': urbisWetstraat, 'language=fr': urbisElsewhere });
    await urbis({ fetch, languages: ['fr', 'nl'] }).search('Wetstraat 16', { language: 'nl-BE' });
    expect(calls).toHaveLength(1);
    const only = fetchBy({ 'language=fr': urbisElsewhere });
    expect(await urbis({ fetch: only.fetch, languages: ['fr'] }).search('Korenmarkt 1 9000 Gent')).toEqual([]);
    expect(() => urbis({ languages: [] })).toThrow(/languages_required/);
  });
});

describe('ICAR, the Walloon register', () => {
  it('reads the score per level and gives the NIS code', async () => {
    const { fetch, calls } = fetchBy({ geocodeWS: icarLiege });
    const [place] = await walloon({ fetch }).search('Place Saint-Lambert 18, 4000 Liège');
    expect(new URL(calls[0]).searchParams.get('crs')).toBe('EPSG:4326');
    expect(place).toMatchObject({
      address: { street: 'Place Saint-Lambert 18', postal_code: '4000', city: 'Liège', region: 'BE-WAL', municipality_code: '62063', country: 'BE' },
      precision: 'rooftop',
      source_code: 'icar',
      external_id: { scheme: 'icar_address', value: '1872629' },
    });
    expect(place.lon).toBeCloseTo(5.5732, 4);
  });

  it('drops the fuzzy municipality it guesses outside Wallonia, and reverses to the nearest number', async () => {
    const away = fetchBy({ geocodeWS: icarElsewhere });
    expect(await walloon({ fetch: away.fetch }).search('Korenmarkt 1, 9000 Gent')).toEqual([]);
    const back = fetchBy({ revgeocode: icarReverse });
    const place = await walloon({ fetch: back.fetch }).reverse(5.5732, 50.6459);
    expect(place).toMatchObject({ address: { street: 'Place Saint-Lambert 18', municipality_code: '62063', region: 'BE-WAL' }, precision: 'rooftop' });
  });
});

describe('the chain of Belgian registers', () => {
  const recordedBelgium = () =>
    belgium({
      fetch: fetchBy({
        'geo.api.vlaanderen.be': geopuntKorenmarkt,
        'irisnet.be': urbisElsewhere,
        geocodeWS: icarElsewhere,
      }).fetch,
    });

  it('finds a Flemish address with Geopunt, before the open fallback', async () => {
    const chain = geocoderFor({ national: recordedBelgium(), fallback: stub('photon', [somewhere('photon')]) });
    const [first] = await chain.search('Korenmarkt 10, 9000 Gent', { country: 'BE' });
    expect(first).toMatchObject({ source_code: 'geopunt', address: { region: 'BE-VLG' } });
  });

  it('finds a Brussels address with UrbIS', async () => {
    const { fetch, calls } = fetchBy({ 'irisnet.be': urbisWetstraat, 'geo.api.vlaanderen.be': geopuntKorenmarkt });
    const chain = geocoderFor({ national: belgium({ fetch }), fallback: stub('photon', [somewhere('photon')]) });
    const [first] = await chain.search('Wetstraat 16 1000 Brussel', { country: 'BE' });
    expect(first).toMatchObject({ source_code: 'urbis', address: { region: 'BE-BRU' } });
    expect(calls.some((u) => u.includes('geo.api.vlaanderen.be'))).toBe(false);
  });

  it('asks the regions in the order the pack gives, and the fallback when none answers', async () => {
    expect(Object.keys(belgium())).toEqual(['BE-BRU', 'BE-VLG', 'BE-WAL']);
    const { fetch } = fetchBy({ 'irisnet.be': urbisElsewhere, geocodeWS: icarElsewhere }, { LocationResult: [] });
    const chain = geocoderFor({ national: belgium({ fetch }), fallback: stub('photon', [somewhere('photon')]) });
    expect((await chain.search('Nowhere 1', { country: 'BE' }))[0].source_code).toBe('photon');
  });
});
