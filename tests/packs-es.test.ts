// The Spanish pack, compiled from packs/es by `nexgen-os pack build es`: who
// the country is, its provinces under their autonomous communities and its
// two time zones, its identifier schemes (the CUPS with its control letters
// among them), its registers and the texts its values cite, its grid
// operators by the CUPS prefixes the transmission operator assigns them, and
// the defaults a study of a Spanish participant starts from, read through
// parameter_of().
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { checkPacks } from '../packages/cli/src/index.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation, repoRoot, participant, joinWithPlace } from './helpers/db.js';

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid', 'actions'], ['es']);
});

afterAll(async () => {
  await db.close();
});

describe('the es pack', () => {
  const p = async (home: string, attributeType: string, at = '2026-10-22') =>
    (await one<{ p: Record<string, unknown> }>(db, "select parameter_of('participant', $1, $2, $3) p", [home, attributeType, at])).p;

  it('says who the country is: currency, languages, time zones, provinces under their communities', async () => {
    const es = await one<Record<string, unknown>>(db,
      `select name, currency, languages, time_zones, region_level, municipality_scheme, pack_version from countries where code = 'ES'`);
    expect(es).toEqual({ name: 'Spain', currency: 'EUR', languages: ['es', 'ca', 'eu', 'gl'], time_zones: ['Europe/Madrid', 'Atlantic/Canary'],
      region_level: 'province', municipality_scheme: 'ine', pack_version: '0.3.0' });
    const counts = await one<{ provinces: number; communities: number }>(db,
      `select count(*) filter (where parent is not null)::int provinces, count(*) filter (where parent is null)::int communities
         from regions where country = 'ES' and kind = 'subdivision'`);
    // 50 provinces; 17 autonomous communities and the autonomous cities of Ceuta and Melilla.
    expect(counts).toEqual({ provinces: 50, communities: 19 });
    expect(await one(db, `select r.name, p.name parent from regions r join regions p on p.code = r.parent where r.code = 'ES-SO'`))
      .toEqual({ name: 'Soria', parent: 'Castilla y León' });

    const org = await organisation(db, 'Un ayuntamiento', USER_A);
    const canary = await joinWithPlace(db, org, 'Ayuntamiento de Las Palmas', { country: 'ES', region: 'ES-GC' });
    expect((await one<{ time_zone: string }>(db, 'select time_zone from participants where id = $1', [canary])).time_zone).toBe('Atlantic/Canary');
    const madrid = await joinWithPlace(db, org, 'Ayuntamiento de Madrid', { country: 'ES', region: 'ES-M', municipality: '28079' });
    expect((await one<{ time_zone: string }>(db, 'select time_zone from participants where id = $1', [madrid])).time_zone).toBe('Europe/Madrid');
    expect(await one(db, 'select municipality_of($1) m', [madrid])).toEqual({ m: 'ES-28079' });
    await expect(joinWithPlace(db, org, 'Nowhere', { country: 'ES', region: 'ES-XX' })).rejects.toThrow(/region_unknown: ES-XX/);
  });

  it('checks a CUPS, the INE code, the NIF of a legal entity and the cadastral reference by their patterns', async () => {
    const schemes = await db.query<{ code: string }>(`select code from identifier_schemes where published_by = 'pack:es' order by code`);
    expect(schemes.rows.map((r) => r.code)).toEqual(['cups', 'ine', 'nif', 'referencia_catastral']);
    const org = await organisation(db, 'Una comunidad de propietarios', USER_A);
    const home = await participant(db, { organisation_id: org, name: 'Vivienda', country: 'ES', region: 'ES-V' });
    // The examples of the operating procedure 10.8: a point with one meter, and a boundary point.
    expect(await insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: 'ES0987543210987654ZF', scheme: 'cups' })).toBeTruthy();
    expect(await insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: 'ES1234123456789012JY1F', scheme: 'cups' })).toBeTruthy();
    await expect(insert(db, 'meters', { organisation_id: org, participant_id: home, identifier: 'ES09875432109876ZF', scheme: 'cups' })).rejects.toThrow(/invalid_identifier/);
    const ok = async (scheme: string, values: string[]) => (await db.query<{ ok: boolean }>(
      `select v ~ (select pattern from identifier_schemes where code = $1) as ok from unnest($2::text[]) v`, [scheme, values])).rows.map((r) => r.ok);
    expect(await ok('ine', ['28079', '08019', '52001', '53001', '2807'])).toEqual([true, true, true, false, false]);
    expect(await ok('nif', ['B12345674', 'A1234567J', 'I12345674', '12345678Z'])).toEqual([true, true, false, false]);
    expect(await ok('referencia_catastral', ['9872023VH5797S0001WX', '9872023VH5797S', '9872023VH5797S0001'])).toEqual([true, true, false]);
  });

  it('brings its registers, the meter data of the distributors under mandate, and the texts its values cite', async () => {
    const rows = await db.query<{ code: string; auth: string | null; redistributable: boolean }>(
      `select code, auth, redistributable from sources where published_by = 'pack:es' and kind <> 'text' order by code`);
    expect(rows.rows.map((r) => r.code)).toEqual(['cartociudad', 'catastro', 'datadis', 'ine_municipalities', 'ree_esios']);
    expect(rows.rows.find((r) => r.code === 'datadis')).toMatchObject({ auth: 'mandate', redistributable: false });
    const countries = await one<{ n: number }>(db, `select count(*)::int n from sources where published_by = 'pack:es' and countries <> '{ES}'`);
    expect(countries.n).toBe(0);
  });

  it('names its grid operators with the CUPS prefixes the transmission operator assigns them', async () => {
    const operators = await db.query<{ code: string; kind: string; identifier_prefixes: string[] }>(
      `select code, kind, identifier_prefixes from grid.operators where country = 'ES' order by code`);
    expect(operators.rows.map((r) => r.code)).toEqual(['begasa', 'ceuta_distribucion', 'edistribucion', 'electrica_de_cadiz', 'electrica_del_ebro',
      'estabanell', 'hidrocantabrico_distribucion', 'i_de', 'melillense', 'ree', 'ufd', 'viesgo_distribucion']);
    expect(operators.rows.find((r) => r.code === 'ree')).toMatchObject({ kind: 'tso', identifier_prefixes: [] });
    expect(operators.rows.find((r) => r.code === 'i_de')).toMatchObject({ kind: 'dso', identifier_prefixes: ['ES0021'] });

    const org = await organisation(db, 'Una cooperativa', USER_A);
    const home = await joinWithPlace(db, org, 'Vivienda en Ceuta', { country: 'ES', region: 'ES-CE', municipality: '51001' });
    const byPrefix = (await one<{ id: string }>(db, 'select declare_meter($1, $2, $3) id', [home, 'ES0031000000000001BJ', 'cups'])).id;
    expect((await one<{ o: unknown }>(db, 'select grid.operator_of($1) o', [byPrefix])).o).toEqual({ operator: 'edistribucion', by: 'prefix', prefix: 'ES0031' });
    // A CUPS whose operator code the pack does not list is placed by the region of its point.
    const byRegion = (await one<{ id: string }>(db, 'select declare_meter($1, $2, $3) id', [home, 'ES0999000000000001QQ', 'cups'])).id;
    expect((await one<{ o: unknown }>(db, 'select grid.operator_of($1) o', [byRegion])).o).toEqual({ operator: 'ceuta_distribucion', by: 'region', region: 'ES-CE' });
  });

  it('answers parameter_of() with its source and period: VAT where it applies, the 2.0 TD off-peak hours, yearly prices', async () => {
    const org = await organisation(db, 'Una pyme', USER_A);
    const valencia = await joinWithPlace(db, org, 'Taller de València', { country: 'ES', region: 'ES-V' });
    const tenerife = await joinWithPlace(db, org, 'Taller de Tenerife', { country: 'ES', region: 'ES-TF' });
    const melilla = await joinWithPlace(db, org, 'Taller de Melilla', { country: 'ES', region: 'ES-ML' });
    expect(await p(valencia, 'bidding_zone')).toMatchObject({ value: '10YES-REE------0', level: 'country', source_code: 'es_entsoe_eic_codes' });
    expect(await p(valencia, 'vat_rate_electricity', '2025-06-01')).toMatchObject({ value: 0.21, level: 'country', valid_from: '2025-01-01' });
    await expect(p(valencia, 'vat_rate_electricity')).rejects.toThrow(/parameter_missing: vat_rate_electricity/);
    await expect(p(tenerife, 'vat_rate_electricity', '2025-06-01')).rejects.toThrow(/parameter_not_decided: vat_rate_electricity in ES-CN/);
    await expect(p(melilla, 'vat_rate_electricity', '2025-06-01')).rejects.toThrow(/parameter_not_decided: vat_rate_electricity in ES-ML/);
    await db.query(`update participants set segment = 'business' where id = $1`, [valencia]);
    await expect(p(valencia, 'offpeak_hours')).rejects.toThrow(/parameter_not_decided: offpeak_hours in ES: Article 7/);
    await db.query(`update participants set segment = 'individual' where id = $1`, [valencia]);
    expect(await p(valencia, 'offpeak_hours')).toMatchObject({ value: [['00:00', '08:00']], conditions: { segment: 'residential' } });
    expect(await p(valencia, 'energy_price_household', '2024-06-01')).toMatchObject({ value: 110.8, valid_from: '2024-01-01' });
    expect(await p(valencia, 'energy_price_business')).toMatchObject({ value: 90.9, valid_from: '2025-01-01' });
    expect(await p(valencia, 'grid_fees_and_taxes')).toMatchObject({ value: 153.0 });
    await expect(p(valencia, 'grid_co2_factor')).rejects.toThrow(/parameter_missing: grid_co2_factor .* reached country ES/);
  });

  it('publishes the frames of Spanish law, and the perimeter of a collective self-consumption for its kind only', async () => {
    const kinds = await db.query<{ code: string; parent: string }>(`select code, parent_code parent from project_kinds where country = 'ES' order by code`);
    expect(kinds.rows).toEqual([
      { code: 'es_autoconsumo_colectivo', parent: 'collective_self_consumption' },
      { code: 'es_autoconsumo_individual', parent: 'individual_self_consumption' },
      { code: 'es_comunidad_ciudadana_energia', parent: 'energy_community' },
      { code: 'es_comunidad_energias_renovables', parent: 'energy_community' },
    ]);
    const org = await organisation(db, 'Una gestora de autoconsumo', USER_A);
    const kindOf = async (kind: string) => (await one<{ id: string }>(db,
      `insert into projects (organisation_id, name, kind, country) values ($1, $2, $3, 'ES') returning id`, [org, `A ${kind}`, kind])).id;
    const collective = await kindOf('es_autoconsumo_colectivo');
    const member = (await one<{ id: string }>(db, 'select join_project($1, $2, $3) id', [collective, 'Vecino', JSON.stringify({ country: 'ES', region: 'ES-M' })])).id;
    expect(await p(member, 'sharing_perimeter')).toMatchObject({ value: ['same_substation', 'radius_around_producer'], valid_from: '2026-03-22' });
    expect(await p(member, 'sharing_radius_m')).toMatchObject({ value: 500 });
    expect(await p(member, 'sharing_settlement_period')).toMatchObject({ value: 'PT1H' });
    const community = await kindOf('es_comunidad_energias_renovables');
    const partner = (await one<{ id: string }>(db, 'select join_project($1, $2, $3) id', [community, 'Socio', JSON.stringify({ country: 'ES', region: 'ES-M' })])).id;
    await expect(p(partner, 'sharing_perimeter')).rejects.toThrow(/parameter_missing: sharing_perimeter/);
  });

  it('plans a Spanish roof installation from the generic templates of the actions module', async () => {
    const org = await organisation(db, 'Una cooperativa', USER_A);
    const roof = await insert(db, 'projects', { organisation_id: org, name: 'Cubierta de la nave', country: 'ES', kind: 'pv_roof', status: 'creation' });
    const plan = await asUser(db, USER_A, () => one<{ p: { created: number; skipped: unknown[] } }>(db, 'select actions.plan($1) p', [roof]));
    expect(plan.p).toMatchObject({ created: 9, skipped: [] });
  });

  it('passes pack check: the committed seed is the exact output of the pack', async () => {
    const report = await checkPacks(repoRoot, { pack: 'es' });
    expect(report.problems).toEqual([]);
    expect(report.packs).toEqual([{ pack: 'es', version: '0.3.0', file: 'supabase/seed/12_pack_es.sql', state: 'up_to_date' }]);
  });
});
