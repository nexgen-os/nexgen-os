// The French pack, compiled from packs/fr by `nexgen-os pack build fr`: who
// the country is and its departments, its identifier schemes, its registers
// and the texts its values cite, its grid operators, and the defaults a
// study of a French participant starts from, read through parameter_of(). The
// national address register, kept as code in the `ban` connector, answers as
// a geocoder of the core's shape, first in the chain for a French search.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderFor, type Fetch, type Geocoder, type Place } from '@nexgen-os/core';
import { ban } from '@nexgen-os/ban';
import { checkPacks } from '../packages/cli/src/index.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot, participant, joinWithPlace } from './helpers/db.js';

const OPERATORS = ['edf_sei', 'edm', 'enedis', 'es_reseaux', 'geg_reseaux', 'geredis', 'rte', 'srd', 'urm'];

const banAnswer = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.316909, 48.870267] },
      properties: { label: '55 Rue du Faubourg Saint-Honoré 75008 Paris', score: 0.97, housenumber: '55', id: '75108_3522_00055', type: 'housenumber', name: '55 Rue du Faubourg Saint-Honoré', postcode: '75008', citycode: '75108', city: 'Paris', context: '75, Paris, Île-de-France', street: 'Rue du Faubourg Saint-Honoré' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [3.8767, 43.6085] },
      properties: { label: 'Place de la Comédie 34000 Montpellier', score: 0.8, id: '34172_1960', type: 'street', name: 'Place de la Comédie', postcode: '34000', citycode: '34172', city: 'Montpellier', context: '34, Hérault, Occitanie' } },
  ],
};
const fetchWith = (body: unknown): Fetch => async () => ({ ok: true, status: 200, json: async () => body });
const stub = (code: string, places: Place[]): Geocoder => ({
  source_code: code,
  search: async () => places,
  reverse: async () => places[0] ?? null,
});
const somewhere = (code: string): Place => ({ address: { country: 'FR' }, lon: 0, lat: 0, precision: 'city', source_code: code, label: code });

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid', 'planning'], ['fr']);
});

afterAll(async () => {
  await db.close();
});

describe('the fr pack', () => {
  it('says who the country is: currency, language, time zones, departments and their regions', async () => {
    const fr = await one<Record<string, unknown>>(db,
      `select name, currency, languages, time_zones[1] tz, region_level, municipality_scheme, pack_version from countries where code = 'FR'`);
    expect(fr).toEqual({ name: 'France', currency: 'EUR', languages: ['fr'], tz: 'Europe/Paris', region_level: 'department',
      municipality_scheme: 'insee', pack_version: '0.3.0' });
    const departments = await one<{ n: number; regions: number }>(db,
      `select count(*) filter (where parent is not null or code ~ '^FR-97')::int n, count(*) filter (where parent is null and code !~ '^FR-97')::int regions from regions where country = 'FR'`);
    expect(departments).toEqual({ n: 103, regions: 13 });
    const finistere = await one<Record<string, unknown>>(db, `select r.name, p.name parent from regions r join regions p on p.code = r.parent where r.code = 'FR-29'`);
    expect(finistere).toEqual({ name: 'Finistère', parent: 'Bretagne' });

    const org = await organisation(db, 'Une commune', USER_A);
    const reunion = await joinWithPlace(db, org, 'Mairie de Saint-Denis', { country: 'FR', region: 'FR-974' });
    expect((await one<{ time_zone: string }>(db, 'select time_zone from participants where id = $1', [reunion])).time_zone).toBe('Indian/Reunion');
    await expect(joinWithPlace(db, org, 'Nowhere', { country: 'FR', region: 'FR-99' })).rejects.toThrow(/region_unknown: FR-99/);
  });

  it('brings its identifier schemes, and a meter number checks its pattern', async () => {
    const schemes = await db.query<{ code: string }>(`select code from id_schemes where published_by = 'pack:fr' order by code`);
    expect(schemes.rows.map((r) => r.code)).toEqual(['ban_address', 'insee', 'parcelle', 'prm', 'rnb_id', 'siren', 'siret']);
    const org = await organisation(db, 'Une régie', USER_A);
    const home = await participant(db, { organisation_id: org, name: 'Mairie', country: 'FR', region: 'FR-2A' });
    expect(await insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: '12345678901234', scheme: 'prm' })).toBeTruthy();
    await expect(insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: '1234', scheme: 'prm' })).rejects.toThrow(/invalid_identifier/);
    const corsica = await one<{ ok: boolean }>(db, `select '2A004' ~ pattern ok from id_schemes where code = 'insee'`);
    expect(corsica.ok).toBe(true);
  });

  it('declares its registers as sources, with their licence, and keeps no law', async () => {
    const ban = await one<Record<string, unknown>>(db, `select kind, license, redistributable, countries from sources where code = 'ban'`);
    expect(ban).toEqual({ kind: 'api', license: 'Licence Ouverte 2.0', redistributable: true, countries: ['FR'] });
    const mandate = await one<Record<string, unknown>>(db, `select auth, redistributable from sources where code = 'enedis_data_connect'`);
    expect(mandate).toEqual({ auth: 'mandate', redistributable: false });
    // A published text is a source only when a value of the pack cites it.
    const uncited = await db.query(`select s.code from sources s where s.published_by = 'pack:fr' and s.kind = 'text'
                                     and not exists (select 1 from defaults d where d.source_code = s.code)`);
    expect(uncited.rows).toEqual([]);
    const gone = await one<Record<string, unknown>>(db,
      `select to_regclass('nexgen.legal_sources')::text legal, to_regclass('nexgen.rules')::text rules, to_regclass('nexgen.grid_operators')::text operators`);
    expect(gone).toEqual({ legal: null, rules: null, operators: null });
    const own = await one<{ n: number }>(db, `select count(*)::int n from planning.templates where country is not null or published_by like 'pack:%'`);
    expect(own.n).toBe(0);
  });

  it('names its grid operators in the grid module, with the departments they serve', async () => {
    const operators = await db.query<{ code: string; kind: string }>(`select code, kind from grid.operators where country = 'FR' order by code`);
    expect(operators.rows.map((r) => r.code)).toEqual(OPERATORS);
    const strasbourg = await one<Record<string, unknown>>(db, `select kind, regions, identifier_scheme from grid.operators where code = 'es_reseaux'`);
    expect(strasbourg).toEqual({ kind: 'dso', regions: ['FR-67'], identifier_scheme: 'prm' });
  });

  it('answers parameter_of() for a participant in France: the country\'s value with its source, a region that decides otherwise, a yearly value by its date', async () => {
    const org = await organisation(db, 'Une SCIC', USER_A);
    const brest = await joinWithPlace(db, org, 'Port de Brest', { country: 'FR', region: 'FR-29' });
    const ajaccio = await joinWithPlace(db, org, 'Port d\'Ajaccio', { country: 'FR', region: 'FR-2A' });
    const p = async (home: string, property: string, at = '2026-10-20') =>
      (await one<{ p: Record<string, unknown> }>(db, "select parameter_of('participant', $1, $2, $3) p", [home, property, at])).p;
    expect(await p(brest, 'metering_step')).toMatchObject({ value: 'PT30M', level: 'country', source_code: 'fr_enedis_load_curve_collection' });
    expect(await p(brest, 'bidding_zone')).toMatchObject({ value: '10YFR-RTE------C', level: 'country' });
    await expect(p(ajaccio, 'bidding_zone')).rejects.toThrow(/parameter_not_decided: bidding_zone in FR-2A/);
    expect(await p(brest, 'energy_price_household', '2024-06-01')).toMatchObject({ value: 152.3, source_code: 'fr_eurostat_household_prices', valid_from: '2024-01-01' });
    expect(await p(brest, 'energy_price_household')).toMatchObject({ value: 108.8, valid_from: '2025-01-01' });
    expect(await p(brest, 'vat_rate_electricity')).toMatchObject({ value: 0.2, level: 'country' });
    await expect(p(brest, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in FR: Pages 1-2/);
    await expect(p(brest, 'pv_specific_yield_fallback')).rejects.toThrow(/parameter_missing: pv_specific_yield_fallback .* reached country FR/);
    // An organisation that knows better holds the property as an attribute, and wins.
    await db.query(`insert into attributes (object_kind, object_id, property_code, value, source) values ('organisation', $1, 'metering_step', '"PT10M"'::jsonb, 'supply contract')`, [org]);
    expect(await p(brest, 'metering_step')).toMatchObject({ value: 'PT10M', level: 'organisation' });
    const voltage = await one<{ levels: { code: string }[] }>(db, `select value levels from defaults where country = 'FR' and property_code = 'voltage_levels'`);
    expect(voltage.levels.map((l) => l.code)).toEqual(['tbt', 'bt', 'hta', 'htb']);
  });

  it('reads a value decided by a region in each of its departments, a department\'s own before it, the country when neither decides', async () => {
    // The pack decides nothing per department or region yet: two values of a test source stand for what one would.
    const org = await organisation(db, 'Une régie', USER_A);
    const paris = await joinWithPlace(db, org, 'Mairie de Paris', { country: 'FR', region: 'FR-75C' });
    const evry = await joinWithPlace(db, org, 'Mairie d\'Évry', { country: 'FR', region: 'FR-91' });
    await db.query(`insert into sources (code, name, kind, base_url, published_by) values ('test_regional_text', 'A text of a region, for this test', 'text', 'https://region.example/', 'test')`);
    await db.query(`insert into defaults (property_code, country, region, value, source_code, reference, published_by) values
                      ('pv_specific_yield_fallback', 'FR', 'FR-IDF', '1000', 'test_regional_text', 'decided by the region', 'test')`);
    const p = async (home: string, property: string) =>
      (await one<{ p: Record<string, unknown> }>(db, "select parameter_of('participant', $1, $2, '2026-10-20') p", [home, property])).p;
    expect(await p(paris, 'pv_specific_yield_fallback')).toMatchObject({ value: 1000, level: 'region', region: 'FR-IDF', reference: 'decided by the region' });
    expect(await p(evry, 'pv_specific_yield_fallback')).toMatchObject({ value: 1000, level: 'region', region: 'FR-IDF' });
    await db.query(`insert into defaults (property_code, country, region, value, source_code, reference, published_by) values
                      ('pv_specific_yield_fallback', 'FR', 'FR-75C', '1010', 'test_regional_text', 'decided by the department', 'test')`);
    expect(await p(paris, 'pv_specific_yield_fallback')).toMatchObject({ value: 1010, level: 'region', region: 'FR-75C' });
    expect(await p(evry, 'pv_specific_yield_fallback')).toMatchObject({ value: 1000, region: 'FR-IDF' });
    expect(await p(paris, 'vat_rate_electricity')).toMatchObject({ value: 0.2, level: 'country', country: 'FR' });
    await db.query(`delete from defaults where published_by = 'test'`);
    await db.query(`delete from sources where code = 'test_regional_text'`);
  });

  it('plans a French roof installation from the generic templates of the planning module', async () => {
    const org = await organisation(db, 'Une coopérative', USER_A);
    const roof = await insert(db, 'projects', { organisation_id: org, name: 'Toiture de la halle', country: 'FR', kind: 'pv_roof', status: 'creation' });
    const plan = await asUser(db, USER_A, () => one<{ p: { created: number; skipped: unknown[] } }>(db, 'select planning.plan($1) p', [roof]));
    expect(plan.p).toMatchObject({ created: 9, skipped: [] });
  });

  it('passes pack check: the committed seed is the exact output of the pack', async () => {
    const report = await checkPacks(repoRoot, { pack: 'fr' });
    expect(report.problems).toEqual([]);
    expect(report.packs).toEqual([{ pack: 'fr', version: '0.3.0', file: 'supabase/seed/10_pack_fr.sql', state: 'up_to_date' }]);
  });

  it('reads the national address register with house-number precision and the department as region', async () => {
    const g = ban({ fetch: fetchWith(banAnswer) });
    const places = await g.search('55 rue du faubourg saint honoré paris');
    expect(places[0]).toMatchObject({
      address: { street: 'Rue du Faubourg Saint-Honoré 55', postal_code: '75008', city: 'Paris', region: 'FR-75C', municipality_code: '75108', country: 'FR' },
      precision: 'rooftop',
      source_code: 'ban',
      external_id: { scheme: 'ban_address', value: '75108_3522_00055' },
    });
    expect(places[1]).toMatchObject({ address: { street: 'Place de la Comédie', region: 'FR-34' }, precision: 'street' });
    expect((await g.reverse(2.3169, 48.8703))?.label).toBe('55 Rue du Faubourg Saint-Honoré 75008 Paris');
  });

  it('gives Paris the ISO 3166-2 code FR-75C, a region the pack lists', async () => {
    const [paris] = await ban({ fetch: fetchWith(banAnswer) }).search('55 rue du faubourg saint honoré paris');
    expect(paris.address.region).toBe('FR-75C');
    const region = await one<{ code: string }>(db, `select code from regions where code = $1`, [paris.address.region]);
    expect(region.code).toBe('FR-75C');
  });
});

describe('the chain of geocoders', () => {
  it('asks the national register first, the open fallback next, the commercial one last', async () => {
    const chain = geocoderFor({
      national: { FR: stub('ban', [somewhere('ban')]) },
      fallback: stub('nominatim', []),
      commercial: stub('mapbox', [somewhere('mapbox')]),
    });
    expect((await chain.search('x', { country: 'FR' }))[0].source_code).toBe('ban');
    expect((await chain.search('x', { country: 'BE' }))[0].source_code).toBe('mapbox');
    const open = geocoderFor({ national: { FR: stub('ban', []) }, fallback: stub('photon', [somewhere('photon')]) });
    expect((await open.search('x', { country: 'FR' }))[0].source_code).toBe('photon');
    expect(await geocoderFor({ fallback: stub('photon', []) }).search('x')).toEqual([]);
    // Belgium keeps one register per region: each is asked in turn before the fallback.
    const belgium = geocoderFor({
      national: { 'BE-BRU': stub('urbis', []), 'BE-VLG': stub('geopunt', [somewhere('geopunt')]), FR: stub('ban', [somewhere('ban')]) },
      fallback: stub('photon', [somewhere('photon')]),
    });
    expect((await belgium.search('x', { country: 'be' }))[0].source_code).toBe('geopunt');
    expect((await belgium.search('x', { country: 'FR' }))[0].source_code).toBe('ban');
  });
});
