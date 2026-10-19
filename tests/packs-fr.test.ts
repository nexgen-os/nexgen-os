// The French pack: its rows load on the core — identifiers, sources, the
// task templates of a roof installation and of an energy community — and
// the national address register, kept as code in formats/geocoding, answers
// as a geocoder of the core's shape, first in the chain for a French search.
// The texts of the law, the rules they set and the grid operators left the
// pack with the 0.2 schema; the pack is redone on its new structure next.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { geocoderFor, type Fetch, type Geocoder, type Place } from '../formats/geocoding/index.js';
import { ban } from '../formats/geocoding/ban.js';
import { USER_A, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

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
  db = await freshDatabase(['community', 'grid', 'tasks'], ['fr']);
});

afterAll(async () => {
  await db.close();
});

describe('the fr pack', () => {
  it('brings its identifier schemes and sources, and the schemes check their patterns', async () => {
    const rows = await db.query<{ code: string; published_by: string }>(`select code, published_by from sources where published_by = 'pack:fr' order by code`);
    expect(rows.rows.map((r) => r.code)).toEqual(['ban', 'bd_topo', 'cadastre', 'enedis_data_connect', 'enedis_open_data', 'geo_api_gouv', 'legifrance', 'odre', 'operat', 'rnb', 'sirene']);
    const org = await organisation(db, 'Une commune', USER_A);
    const site = await insert(db, 'sites', { organisation_id: org, name: 'Mairie', country: 'FR' });
    const meter = await insert(db, 'grid.meters', { organisation_id: org, site_id: site, identifier: '12345678901234', scheme: 'prm' });
    expect(meter).toBeTruthy();
    await expect(insert(db, 'grid.meters', { organisation_id: org, site_id: site, identifier: '1234', scheme: 'prm' })).rejects.toThrow(/invalid_identifier/);
    const n = await one<{ n: number }>(db, `select count(*)::int n from id_schemes where published_by = 'pack:fr'`);
    expect(n.n).toBe(7);
    const siret = await one<{ ok: boolean; ko: boolean }>(db, `select '12345678901234' ~ pattern ok, '123' ~ pattern ko from id_schemes where code = 'siret'`);
    expect(siret).toEqual({ ok: true, ko: false });
    const parcel = await one<{ ok: boolean }>(db, `select '75108000AB0012' ~ pattern ok from id_schemes where code = 'parcelle'`);
    expect(parcel.ok).toBe(true);
  });

  it('keeps no law in the core: no texts, no rules, no operators outside the grid module', async () => {
    const gone = await one<{ legal: string | null; rules: string | null; operators: string | null; rules_on: string | null }>(
      db,
      `select to_regclass('nexgen.legal_sources')::text legal, to_regclass('nexgen.rules')::text rules,
              to_regclass('nexgen.grid_operators')::text operators, to_regprocedure('nexgen.rules_on(char, text, date)')::text rules_on`,
    );
    expect(gone).toEqual({ legal: null, rules: null, operators: null, rules_on: null });
  });

  it('plans the tasks of a French roof installation and of a French energy community from its templates', async () => {
    const org = await organisation(db, 'Une coopérative', USER_A);
    const roof = await insert(db, 'community.projects', { organisation_id: org, name: 'Toiture de la halle', country: 'FR', kind: 'pv_roof', status: 'creation' });
    await db.query(`insert into attributes (object_id, property_code, value, source) values ($1, 'installed_power', '36'::jsonb, 'design')`, [roof]);
    const plan = await asUser(db, USER_A, () => one<{ p: { created: number; skipped: unknown[] } }>(db, 'select tasks.plan($1) p', [roof]));
    expect(plan.p).toMatchObject({ created: 10, skipped: [] });
    const names = await db.query<{ name: string; phase: string; role: string }>(`select t.name, t.phase, t.role from tasks.tasks t join tasks.phases p on p.code = t.phase where subject_id = $1 order by p.position, t.name`, [roof]);
    expect(names.rows.map((r) => r.phase)).toEqual(['study', 'design', 'permitting', 'financing', 'procurement', 'installation', 'grid_connection', 'grid_connection', 'commissioning', 'handover']);
    expect(names.rows.some((r) => r.name.startsWith('Purchase-obligation contract'))).toBe(true);
    expect(names.rows.some((r) => r.name.startsWith('Bid in the simplified'))).toBe(false);
    const consuel = await one<{ legal_reference: string; depends: string }>(db, `select tp.legal_reference, d.name depends from tasks.tasks t join tasks.templates tp on tp.id = t.template_id left join tasks.tasks d on d.id = t.depends_on where t.subject_id = $1 and tp.code = 'pv_roof_consuel'`, [roof]);
    expect(consuel).toEqual({ legal_reference: 'D. 342-16 à D. 342-21', depends: 'Arrays mounted and wired' });

    const community = await insert(db, 'community.projects', { organisation_id: org, name: 'Énergie partagée du bourg', country: 'FR', kind: 'energy_community', status: 'creation' });
    const first = await one<{ p: { created: number; skipped: { code: string }[] } }>(db, 'select tasks.plan($1) p', [community]);
    expect(first.p.created).toBe(9);
    expect(first.p.skipped.map((s) => s.code)).toEqual(['acc_power_over_cap']);
    await db.query(`insert into attributes (object_id, property_code, value, source) values ($1, 'installed_power', '6200'::jsonb, 'study')`, [community]);
    expect((await one<{ p: { created: number } }>(db, 'select tasks.plan($1) p', [community])).p.created).toBe(1);
  });

  it('reads the national address register with house-number precision and the department as region', async () => {
    const g = ban({ fetch: fetchWith(banAnswer) });
    const places = await g.search('55 rue du faubourg saint honoré paris');
    expect(places[0]).toMatchObject({
      address: { street: 'Rue du Faubourg Saint-Honoré 55', postal_code: '75008', city: 'Paris', region: 'FR-75', municipality_code: '75108', country: 'FR' },
      precision: 'rooftop',
      source_code: 'ban',
      external_id: { scheme: 'ban_address', value: '75108_3522_00055' },
    });
    expect(places[1]).toMatchObject({ address: { street: 'Place de la Comédie', region: 'FR-34' }, precision: 'street' });
    expect((await g.reverse(2.3169, 48.8703))?.label).toBe('55 Rue du Faubourg Saint-Honoré 75008 Paris');
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
