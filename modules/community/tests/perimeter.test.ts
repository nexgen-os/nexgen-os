// The perimeter of an energy sharing operation, as its country's pack writes
// it: the rule (`sharing_perimeter`, criteria any one of which suffices) and
// its values are defaults resolved by parameter_of(); check_perimeter() says,
// for each participant, whether it is in, by which criterion, with which
// value and from which text. France: the distance between the two
// participants furthest apart, by density class of the municipality.
// Wallonia: the same municipality, or downstream of the same substation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, one, organisation } from '../../../tests/helpers/db.js';

let db: PGlite;
let org: string;

interface Row {
  name: string;
  in_perimeter: boolean | null;
  criteria: Array<Record<string, any>>;
  rule: Record<string, any>;
}
const check = async (project: string, on = '2026-06-01') =>
  Object.fromEntries((await db.query<Row>('select * from community.check_perimeter($1, $2)', [project, on])).rows.map((r) => [r.name, r]));
// A point `km` kilometres east of a longitude, on a latitude.
const east = (lon: number, lat: number, km: number) => ({
  type: 'Point', coordinates: [lon + (km * 1000) / (111_320 * Math.cos((lat * Math.PI) / 180)), lat],
});
const join = async (project: string, name: string, category: string, place: Record<string, unknown>) =>
  (await one<{ id: string }>(db, `select join_project($1, $2, $3, $4) id`, [project, name, JSON.stringify(place), category])).id;

beforeAll(async () => {
  db = await freshDatabase(['community', 'grid'], ['fr', 'be']);
  org = await organisation(db, 'A sharing operator');
});

afterAll(async () => {
  await db.close();
});

describe('France: an extended collective self-consumption', () => {
  it('holds the two participants furthest apart within the distance of the rules, and a greater one only once the project records its derogation', async () => {
    const acc = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'ACC', 'fr_acc', 'FR') returning id`, [org])).id;
    // Arandas (rural, 20 km by derogation), Belley (urban belt, 10 km by derogation), 8 km apart.
    await join(acc, 'Plant', 'producer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 0) });
    await join(acc, 'Near', 'consumer', { country: 'FR', region: 'FR-01', municipality: '01034', geometry: east(5.4, 45.8, 8) });
    const before = await check(acc);
    // No derogation granted: the general 2 km hold, and the criterion says what a request may grant, 10 km for all.
    expect(before.Near.in_perimeter).toBe(false);
    expect(before.Near.criteria[0]).toMatchObject({ criterion: 'max_distance_between_members', in: false, value_m: 2000, derogation_m: 10000 });
    expect(before.Near.criteria[0].value_from).toMatchObject({ level: 'country', conditions: { project_kind: 'fr_acc' }, source_code: 'fr_arrete_acc_perimeter' });
    expect(before.Near.criteria[0].derogation_from).toMatchObject({ conditions: { project_kind: 'fr_acc', density_class: 'urban_belt' }, source_code: 'fr_arrete_acc_perimeter' });
    expect(before.Near.rule).toMatchObject({ criteria: ['max_distance_between_members'], level: 'country', conditions: { project_kind: 'fr_acc' }, source_code: 'fr_arrete_acc_perimeter' });

    // The derogation granted is the project's own distance, its decision the source, from the day it is granted.
    await db.query(`select set_attribute('project', $1, 'sharing_max_distance_m', '10000'::jsonb, '2026-05-01', null, 'Decision of the minister granting the derogation, 1 May 2026', 'published')`, [acc]);
    expect((await check(acc, '2026-04-30')).Near.in_perimeter).toBe(false);
    const r = await check(acc);
    expect(r.Near.in_perimeter).toBe(true);
    expect(r.Near.criteria[0]).toMatchObject({ criterion: 'max_distance_between_members', in: true, value_m: 10000, derogation_m: 10000 });
    expect(r.Near.criteria[0].distance_m).toBeCloseTo(8000, -2);
    expect(r.Near.criteria[0].value_from).toMatchObject({ level: 'project', object_id: acc, reference: 'Decision of the minister granting the derogation, 1 May 2026', quality: 'published' });

    // A third member 12 km from the plant: the pair furthest apart breaks the rule, both its ends are out.
    await join(acc, 'Far', 'consumer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 12) });
    const again = await check(acc);
    expect([again.Plant.in_perimeter, again.Near.in_perimeter, again.Far.in_perimeter]).toEqual([false, true, false]);
    // A member in Lyon (a large urban centre) allows no derogation: none is said, the project's decision is still read.
    await join(acc, 'City', 'consumer', { country: 'FR', region: 'FR-69M', municipality: '69123', geometry: east(5.4, 45.8, 1) });
    const city = (await check(acc)).City.criteria[0];
    expect(city).toMatchObject({ value_m: 10000, in: false });
    expect(city).not.toHaveProperty('derogation_m');
  });

  it('answers null for a participant without a place on the map, and refuses a project with no rule by name', async () => {
    const acc = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'ACC 2', 'fr_acc', 'FR') returning id`, [org])).id;
    await join(acc, 'Plant', 'producer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 0) });
    await join(acc, 'Somewhere', 'consumer', { country: 'FR', region: 'FR-01', municipality: '01013' });
    expect((await check(acc)).Somewhere.in_perimeter).toBeNull();
    const aci = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'Roof', 'fr_aci', 'FR') returning id`, [org])).id;
    await join(aci, 'Farm', 'prosumer', { country: 'FR', region: 'FR-01', municipality: '01013' });
    await expect(check(aci)).rejects.toThrow(/parameter_missing: sharing_perimeter/);
  });
});

describe('Wallonia: a renewable energy community', () => {
  it('holds a participant of the producer\'s municipality, or one downstream of the same substation, and decides nothing it cannot read', async () => {
    const cer = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'CER', 'be_cer', 'BE') returning id`, [org])).id;
    const plant = await join(cer, 'Plant', 'producer', { country: 'BE', region: 'BE-WAL', municipality: '62063' });
    await join(cer, 'Neighbour', 'consumer', { country: 'BE', region: 'BE-WAL', municipality: '62063' });
    const namur = await join(cer, 'Namur school', 'consumer', { country: 'BE', region: 'BE-WAL', municipality: '92094' });
    await join(cer, 'Charleroi shop', 'consumer', { country: 'BE', region: 'BE-WAL', municipality: '52011' });

    const station = (await one<{ id: string }>(db,
      `insert into grid.substations (operator, code, name, voltage_levels, published_by) values ('ores', 'TEST-1', 'A substation', '{}', 'test') returning id`)).id;
    for (const [p, ean] of [[plant, '541449000000000011'], [namur, '541449000000000012']]) {
      const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [p, ean])).id;
      await db.query(`select grid.connect_to_operator($1, 'ores', null, $2)`, [meter, station]);
    }

    const r = await check(cer);
    expect(r.Neighbour.in_perimeter).toBe(true);
    expect(r.Neighbour.rule).toMatchObject({ criteria: ['same_municipality', 'same_substation'], level: 'region', region: 'BE-WAL', source_code: 'be_wal_energy_sharing_order' });
    expect(r['Namur school'].in_perimeter).toBe(true);
    expect(r['Namur school'].criteria).toEqual([
      expect.objectContaining({ criterion: 'same_municipality', in: false }),
      expect.objectContaining({ criterion: 'same_substation', in: true }),
    ]);
    // Neither its municipality nor a substation said: not decided.
    expect(r['Charleroi shop'].in_perimeter).toBeNull();

    // A wind turbine may extend the perimeter to an adjacent municipality
    // (9 km from the limit): the limits are not in the model, so it is said, not decided.
    await db.query(`select install_device($1, 'wind', 'Turbine')`, [plant]);
    const wind = await check(cer);
    expect(wind['Charleroi shop'].criteria[0]).toMatchObject({ criterion: 'same_municipality', in: null, extension: [{ value_m: 9000, source_code: 'be_wal_energy_sharing_order' }] });
  });
});

describe('the power of an operation', () => {
  it('is the sum of the installed powers of its producers, read against the smallest cap its rules say at their places', async () => {
    const acc = (await one<{ id: string }>(db, `insert into projects (organisation_id, name, kind, country) values ($1, 'ACC power', 'fr_acc', 'FR') returning id`, [org])).id;
    const plant = await join(acc, 'Plant', 'producer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 0) });
    const farm = await join(acc, 'Farm', 'prosumer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 1) });
    await join(acc, 'Home', 'consumer', { country: 'FR', region: 'FR-01', municipality: '01013', geometry: east(5.4, 45.8, 2) });
    const power = async () => (await one<{ p: Record<string, any> }>(db, `select community.check_power($1, '2026-06-01') p`, [acc])).p;

    // No device carries a power yet; the cap is the pack's for the kind of the project, at its participants' places.
    expect(await power()).toMatchObject({
      max_kw: 5000, installed_kw: null, within: null,
      value_from: { level: 'country', value: 5000, conditions: { project_kind: 'fr_acc' }, source_code: 'fr_arrete_acc_perimeter' },
    });

    await db.query(`select install_device($1, 'solar', 'Roof', p_rated_power_kw => 250)`, [plant]);
    await db.query(`select install_device($1, 'solar', 'Barn', p_rated_power_kw => 36)`, [farm]);
    expect(await power()).toMatchObject({
      installed_kw: 286, within: true,
      producers: [{ name: 'Farm', installed_kw: 36 }, { name: 'Plant', installed_kw: 250 }],
    });

    // A participant in a non-interconnected zone: its region's smaller cap holds for the whole operation.
    const island = await join(acc, 'Island', 'consumer', { country: 'FR', region: 'FR-2A', geometry: east(8.7, 41.9, 0) });
    expect(await power()).toMatchObject({ max_kw: 500, installed_kw: 286, within: true, value_from: { level: 'region', region: 'FR-2A', value: 500 } });
    await db.query(`update participants set leave_date = '2026-05-31' where id = $1`, [island]);
    expect(await power()).toMatchObject({ max_kw: 5000, within: true });

    // The cap, said for the project with its source (a derogation, an agreement): it comes before the pack's. 300 kW holds, 250 does not.
    await db.query(`select set_attribute('project', $1, 'sharing_max_power_kw', '300'::jsonb, null, null, 'the operation''s agreement')`, [acc]);
    expect(await power()).toMatchObject({ max_kw: 300, installed_kw: 286, within: true, value_from: { level: 'project', value: 300 } });
    await db.query(`update attributes set value = '250' where object_id = $1 and attribute_type = 'sharing_max_power_kw'`, [acc]);
    expect(await power()).toMatchObject({ max_kw: 250, within: false });
  });
});
