// The Belgian pack, compiled from packs/be by `nexgen-os pack build be`: who
// the country is and its three regions, its identifier schemes, its regional
// registers and the texts its values cite, its grid operators by region, and
// the defaults a study of a Belgian participant starts from, read through
// parameter_of(). The three regional address registers, kept as code in
// the geocoder connectors, answer as geocoders of the core's shape on a recorded
// answer, and the chain asks Brussels, Flanders and Wallonia in turn before
// the open fallback.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderFor, type Fetch, type Geocoder, type Place } from '@nexgen-os/core';
import { geopunt } from '@nexgen-os/geopunt';
import { icar as walloon } from '@nexgen-os/icar';
import { urbis } from '@nexgen-os/urbis';
import { checkPacks } from '../packages/cli/src/index.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot, participant, joinWithPlace } from './helpers/db.js';

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
  db = await freshDatabase(['community', 'grid', 'actions'], ['be']);
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
  const p = async (home: string, attributeType: string, at = '2026-10-20') =>
    (await one<{ p: Record<string, unknown> }>(db, "select parameter_of('participant', $1, $2, $3) p", [home, attributeType, at])).p;
  const inRegion = async (org: string, region: string) =>
    joinWithPlace(db, org, `A participant in ${region}`, { country: 'BE', region });

  it('says who the country is: currency, languages, time zone and the three regions', async () => {
    const be = await one<Record<string, unknown>>(db,
      `select name, currency, languages, time_zones, region_level, municipality_scheme, pack_version from countries where code = 'BE'`);
    expect(be).toEqual({ name: 'Belgium', currency: 'EUR', languages: ['fr', 'nl', 'de'], time_zones: ['Europe/Brussels'], region_level: 'region',
      municipality_scheme: 'nis', pack_version: '0.4.0' });
    const regions = await db.query<{ code: string }>(`select code from regions where country = 'BE' and kind = 'subdivision' order by code`);
    expect(regions.rows.map((r) => r.code)).toEqual(['BE-BRU', 'BE-VLG', 'BE-WAL']);
    // Its names in the languages of the country, as ISO 3166-2 writes them.
    expect(await one(db, `select names from regions where code = 'BE-BRU'`)).toEqual({ names: { fr: 'Région de Bruxelles-Capitale', nl: 'Brussels Hoofdstedelijk Gewest' } });
    // One level: a region has no parent, and parameter_of() goes from the region to the country.
    expect(await one<{ n: number }>(db, `select count(*)::int n from regions where country = 'BE' and kind = 'subdivision' and parent_code is not null`)).toEqual({ n: 0 });
    const org = await organisation(db, 'Une commune', USER_A);
    const home = await inRegion(org, 'BE-WAL');
    expect((await one<{ time_zone: string }>(db, 'select time_zone from participants where id = $1', [home])).time_zone).toBe('Europe/Brussels');
    await expect(joinWithPlace(db, org, 'Nowhere', { country: 'BE', region: 'BE-XXX' })).rejects.toThrow(/region_unknown: BE-XXX/);
  });

  it('brings its sources, each regional one saying its region, and the texts its values cite', async () => {
    const rows = await db.query<{ code: string; regions: string[] }>(`select code, regions from sources where published_by = 'pack:be' and kind <> 'text' order by code`);
    expect(Object.fromEntries(rows.rows.map((r) => [r.code, r.regions]))).toEqual({
      basisregisters_vlaanderen: ['BE-VLG'],
      elia_open_data: [],
      fluvius_open_data: ['BE-VLG'],
      geopunt: ['BE-VLG', 'BE-BRU'],
      icar: ['BE-WAL'],
      kbo_bce: [],
      rmi_aws: [],
      statbel: [],
      urbis: ['BE-BRU'],
    });
    const icar = await one<{ redistributable: boolean }>(db, `select redistributable from sources where code = 'icar'`);
    expect(icar.redistributable).toBe(false);
    const countries = await one<{ n: number }>(db, `select count(*)::int n from sources where published_by = 'pack:be' and countries <> '{BE}'`);
    expect(countries.n).toBe(0);
    // A published text is a source only when a value or a frame of the pack cites it.
    const uncited = await db.query(`select s.code from sources s where s.published_by = 'pack:be' and s.kind = 'text'
                                     and not exists (select 1 from defaults d where d.source_code = s.code)
                                     and not exists (select 1 from project_kinds k where k.source_code = s.code)`);
    expect(uncited.rows).toEqual([]);
    const gone = await one<Record<string, unknown>>(db, `select to_regclass('nexgen.legal_sources')::text legal, to_regclass('nexgen.rules')::text rules`);
    expect(gone).toEqual({ legal: null, rules: null });
  });

  it('brings its identifier schemes, reads a Belgian EAN on the core GSRN scheme, and checks the NIS code', async () => {
    const schemes = await db.query<{ code: string }>(`select code from identifier_schemes where published_by = 'pack:be' order by code`);
    expect(schemes.rows.map((r) => r.code)).toEqual(['enterprise_number', 'icar_address', 'nis', 'urbis_building', 'vlaanderen_address', 'vlaanderen_building']);
    const org = await organisation(db, 'Een gemeente', USER_A);
    const home = await participant(db, { organisation_id: org, name: 'Stadhuis', country: 'BE', region: 'BE-VLG' });
    // The municipality is an identifier of the participant under the pack's scheme.
    await db.query(`select add_identifier('participant', $1, 'nis', '44021')`, [home]);
    await expect(db.query(`select add_identifier('participant', $1, 'nis', '4402')`, [home])).rejects.toThrow(/invalid_identifier/);
    expect((await one<{ place: { identifiers: unknown[] } }>(db, 'select place_of($1) place', [home])).place.identifiers).toEqual([{ scheme: 'nis', value: '44021' }]);
    expect(await insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: '541448820000000017', scheme: 'gs1_gsrn' })).toBeTruthy();
    await expect(insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: '54144882000000001', scheme: 'gs1_gsrn' })).rejects.toThrow(/invalid_identifier/);
    const nis = await db.query<{ ok: boolean }>(
      `select v ~ (select pattern from identifier_schemes where code = 'nis') as ok from unnest(array['44021', '21004', '62063', '4402', '440210']) v`,
    );
    expect(nis.rows.map((r) => r.ok)).toEqual([true, true, true, false, false]);
  });

  it('names its grid operators in the grid module, by region', async () => {
    const operators = await db.query<{ code: string }>(`select code from grid.operators where country = 'BE' order by code`);
    expect(operators.rows.map((r) => r.code)).toEqual(['aieg', 'aiesh', 'elia', 'fluvius', 'ores', 'resa', 'rew', 'sibelga']);
    const fluvius = await one<Record<string, unknown>>(db, `select kind, regions, identifier_scheme from grid.operators where code = 'fluvius'`);
    expect(fluvius).toEqual({ kind: 'dso', regions: ['BE-VLG'], identifier_scheme: 'gs1_gsrn' });
    const elia = await one<Record<string, unknown>>(db, `select kind, regions from grid.operators where code = 'elia'`);
    expect(elia).toEqual({ kind: 'tso', regions: [] });
  });

  it('answers parameter_of() for a participant in each region: a regional value with its source, a country value, a yearly value by its date', async () => {
    const org = await organisation(db, 'Une coopérative', USER_A);
    const flanders = await inRegion(org, 'BE-VLG');
    const brussels = await inRegion(org, 'BE-BRU');
    const wallonia = await inRegion(org, 'BE-WAL');
    expect(await p(flanders, 'metering_step')).toMatchObject({ value: 'PT15M', level: 'region', source_code: 'be_fluvius_quarter_hour' });
    expect(await p(brussels, 'metering_step')).toMatchObject({ value: 'PT15M', level: 'region', source_code: 'be_sibelga_consumption_history' });
    expect(await p(wallonia, 'metering_step')).toMatchObject({ value: 'PT15M', level: 'region', source_code: 'be_ores_smart_meter' });
    for (const home of [flanders, brussels, wallonia]) {
      expect(await p(home, 'bidding_zone')).toMatchObject({ value: '10YBE----------2', level: 'country', source_code: 'be_entsoe_eic_codes' });
      expect(await p(home, 'vat_rate_electricity')).toMatchObject({ value: 0.06, level: 'country', valid_from: '2023-04-01' });
    }
    expect(await p(brussels, 'energy_price_household', '2024-06-01')).toMatchObject({ value: 156.4, valid_from: '2024-01-01' });
    expect(await p(brussels, 'energy_price_household')).toMatchObject({ value: 154.1, valid_from: '2025-01-01' });
    expect(await p(brussels, 'grid_fees_and_taxes')).toMatchObject({ value: 199.5 });
    await expect(p(flanders, 'pv_specific_yield_fallback')).rejects.toThrow(/parameter_missing: pv_specific_yield_fallback .* reached country BE/);
    // An organisation that knows better holds the attribute type as an attribute, and wins.
    await db.query(`insert into attributes (object_kind, object_id, attribute_type, value, source) values ('organisation', $1, 'metering_step', '"PT5M"'::jsonb, 'supply contract')`, [org]);
    expect(await p(wallonia, 'metering_step')).toMatchObject({ value: 'PT5M', level: 'organisation' });
  });

  it('plans a Belgian roof installation from the generic templates of the actions module', async () => {
    const org = await organisation(db, 'Een coöperatie', USER_A);
    const roof = await insert(db, 'projects', { organisation_id: org, name: 'Dak van de loods', country: 'BE', kind: 'pv_roof', status: 'creation' });
    const plan = await asUser(db, USER_A, () => one<{ p: { created: number; skipped: unknown[] } }>(db, 'select actions.plan($1) p', [roof]));
    expect(plan.p).toMatchObject({ created: 9, skipped: [] });
    const own = await one<{ n: number }>(db, `select count(*)::int n from actions.templates where country is not null or published_by like 'pack:%'`);
    expect(own.n).toBe(0);
  });

  it('passes pack check: the committed seed is the exact output of the pack', async () => {
    const report = await checkPacks(repoRoot, { pack: 'be' });
    expect(report.problems).toEqual([]);
    expect(report.packs).toEqual([{ pack: 'be', version: '0.4.0', file: 'supabase/seed/11_pack_be.sql', state: 'up_to_date' }]);
  });
});

describe('Geopunt, the Flemish register', () => {
  it('keeps the street only when the house number it matched is not the one asked', async () => {
    const { fetch, calls } = fetchBy({ 'geo.api.vlaanderen.be': geopuntKorenmarkt });
    const places = await geopunt({ fetch }).search('Korenmarkt 1, 9000 Gent');
    expect(calls[0]).toContain('/geolocation/v4/Location?q=Korenmarkt+1%2C+9000+Gent');
    // The register answered Korenmarkt 10, 11 and 12 for Korenmarkt 1.
    expect(places[0]).toMatchObject({
      address: { address_line1: 'Korenmarkt', postal_code: '9000', city: 'Gent', region: 'BE-VLG', municipality_code: null, country: 'BE' },
      precision: 'street',
      source_code: 'geopunt',
      label: 'Korenmarkt, 9000 Gent',
    });
    expect(places[0].identifier).toBeUndefined();
    expect(places.every((p) => p.precision === 'street')).toBe(true);
  });

  it('places a house number asked at the rooftop, with its address identifier', async () => {
    const { fetch } = fetchBy({ 'geo.api.vlaanderen.be': geopuntKorenmarkt });
    const [first] = await geopunt({ fetch }).search('Korenmarkt 10 Gent');
    expect(first).toMatchObject({
      address: { address_line1: 'Korenmarkt 10', region: 'BE-VLG' },
      precision: 'rooftop',
      label: 'Korenmarkt 10, 9000 Gent',
      identifier: { scheme: 'vlaanderen_address', value: '602422' },
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
      address: { address_line1: 'Wetstraat 16', postal_code: '1000', city: 'Brussel', region: 'BE-BRU', municipality_code: null, country: 'BE' },
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
      address: { address_line1: 'Place Saint-Lambert 18', postal_code: '4000', city: 'Liège', region: 'BE-WAL', municipality_code: '62063', country: 'BE' },
      precision: 'rooftop',
      source_code: 'icar',
      identifier: { scheme: 'icar_address', value: '1872629' },
    });
    expect(place.lon).toBeCloseTo(5.5732, 4);
  });

  it('drops the fuzzy municipality it guesses outside Wallonia, and reverses to the nearest number', async () => {
    const away = fetchBy({ geocodeWS: icarElsewhere });
    expect(await walloon({ fetch: away.fetch }).search('Korenmarkt 1, 9000 Gent')).toEqual([]);
    const back = fetchBy({ revgeocode: icarReverse });
    const place = await walloon({ fetch: back.fetch }).reverse(5.5732, 50.6459);
    expect(place).toMatchObject({ address: { address_line1: 'Place Saint-Lambert 18', municipality_code: '62063', region: 'BE-WAL' }, precision: 'rooftop' });
  });
});

// The three registers keyed by region for `geocoderFor`, in the order a
// search tries them: Brussels first (UrbIS keeps only what it finds in
// Brussels), Flanders next (Geopunt finds nothing in Wallonia), Wallonia
// last (ICAR guesses a municipality for anything it does not know).
const belgium = (options: { fetch?: Fetch } = {}): Record<'BE-BRU' | 'BE-VLG' | 'BE-WAL', Geocoder> => ({
  'BE-BRU': urbis({ fetch: options.fetch, languages: ['fr', 'nl'] }),
  'BE-VLG': geopunt({ fetch: options.fetch }),
  'BE-WAL': walloon({ fetch: options.fetch }),
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

describe('what Belgium decides per frame and municipality', () => {
  it('publishes the frames of its regions and lists municipalities by their NIS code', async () => {
    const kinds = await db.query<{ code: string }>(`select code from project_kinds where country = 'BE' order by code`);
    expect(kinds.rows.map((k) => k.code)).toEqual(['be_cec', 'be_cel', 'be_cer', 'be_energy_sharing']);
    expect(await one(db, `select name, kind, parent_code from regions where code = 'BE-62063'`)).toEqual({ name: 'Liège', kind: 'municipality', parent_code: 'BE-WAL' });
  });

  it('decides no sharing perimeter yet: the regional rules wait for their texts to be read', async () => {
    const org = await organisation(db, 'Une coopérative', USER_A);
    const cer = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'CER du Condroz', 'be_cer', 'BE') returning id`, [org])).id;
    const farm = (await one<{ id: string }>(db, `select join_project($1, 'Ferme', $2) id`, [cer, JSON.stringify({ country: 'BE', region: 'BE-WAL', municipality: '92094' })])).id;
    expect(await one(db, 'select municipality_of($1) m', [farm])).toEqual({ m: 'BE-92094' });
    await expect(one(db, `select parameter_of('participant', $1, 'sharing_max_distance_m')`, [farm]))
      .rejects.toThrow(/parameter_missing: sharing_max_distance_m for .*, reached country BE/);
    await expect(insert(db, 'projects', { organisation_id: org, name: 'ACC', kind: 'fr_acc', country: 'BE' })).rejects.toThrow(/project_kind_unknown|project_kind_foreign/);
  });
});
