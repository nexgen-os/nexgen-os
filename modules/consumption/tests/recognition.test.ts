// A device recognised by disaggregation: a source reads the curve of a
// meter and recognises the equipment behind it. A device of the
// participant signed by the source, its confidence, the simulated series
// of its consumption and the recommendation that asks the end customer —
// no table of its own; validated, the device is the customer's
// declaration; dismissed, it is retired.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, asUser, freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';

const CUSTOMER = '00000000-0000-4000-8000-0000000000d1';
let db: PGlite;
let org: string;
let home: string;

type Recognised = { device_id: string; series_id: string; action_id: string; created: boolean };
const recognise = (type: string, confidence: number) =>
  one<Recognised>(db, `select * from consumption.recognise_device($1, $2, 'disaggregation_model', $3)`, [home, type, confidence]);

beforeAll(async () => {
  db = await freshDatabase(['actions', 'consumption']);
  org = await organisation(db, 'A supplier', USER_A);
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Customers', country: 'BE' });
  home = (await one<{ id: string }>(db, `select join_project($1, 'Household', '{"country": "BE"}') id`, [project])).id;
  await db.query(`insert into sources (code, name, kind) values ('disaggregation_model', 'A disaggregation model', 'api')`);
  await db.query(`insert into auth.users (id) values ($1) on conflict do nothing`, [CUSTOMER]);
  await db.query('update participants set user_id = $2 where id = $1', [home, CUSTOMER]);
});

afterAll(async () => {
  await db.close();
});

describe('a recognised device', () => {
  it('is a device of the participant, its confidence, a simulated series and a recommendation, signed by the source', async () => {
    const r = await recognise('heat_pump', 0.82);
    expect(r.created).toBe(true);
    expect(await one(db, 'select participant_id, device_type, source_code, status from devices where id = $1', [r.device_id]))
      .toEqual({ participant_id: home, device_type: 'heat_pump', source_code: 'disaggregation_model', status: 'in_service' });
    expect(await one(db, `select value, source_code from attributes where object_id = $1 and attribute_type = 'recognition_confidence'`, [r.device_id]))
      .toEqual({ value: 0.82, source_code: 'disaggregation_model' });
    expect(await one(db, 'select object_kind, object_id, kind, source_code, quantity_code from series where id = $1', [r.series_id]))
      .toEqual({ object_kind: 'device', object_id: r.device_id, kind: 'simulated', source_code: 'disaggregation_model', quantity_code: 'consumption_energy' });
    expect(await one(db, 'select kind, status, source, source_ref, estimate_kind, estimate_id from actions.actions where id = $1', [r.action_id]))
      .toEqual({ kind: 'recommendation', status: 'proposed', source: 'detector', source_ref: 'disaggregation_model', estimate_kind: 'nexgen.series', estimate_id: r.series_id });
  });

  it('is recorded once per participant, device type and source', async () => {
    const first = await recognise('heat_pump', 0.82);
    const again = await recognise('heat_pump', 0.9);
    expect(again).toEqual({ ...first, created: false });
    expect(await one(db, `select count(*)::int n from devices where participant_id = $1 and device_type = 'heat_pump'`, [home])).toEqual({ n: 1 });
    expect(await one(db, `select value from attributes where object_id = $1 and attribute_type = 'recognition_confidence' and valid_to is null`, [first.device_id]))
      .toEqual({ value: 0.9 });
  });

  it('becomes the customer\'s declaration once the customer validates it', async () => {
    const r = await recognise('heat_pump', 0.9);
    expect(await asUser(db, CUSTOMER, async () => (await db.query('select name from devices')).rows)).toHaveLength(1);
    await asUser(db, CUSTOMER, () => db.query(`select actions.decide($1, 'validated')`, [r.action_id]));
    expect(await one(db, 'select source_code, status from devices where id = $1', [r.device_id]))
      .toEqual({ source_code: 'customer_declaration', status: 'in_service' });
    expect(await one(db, 'select source_code from series where id = $1', [r.series_id])).toEqual({ source_code: 'disaggregation_model' });
    expect((await recognise('heat_pump', 0.95)).created).toBe(false);
  });

  it('is retired when the customer dismisses it', async () => {
    const r = await recognise('boiler', 0.4);
    await asUser(db, CUSTOMER, () => db.query(`select actions.decide($1, 'dismissed')`, [r.action_id]));
    expect(await one(db, 'select status, removal_date is not null removed from devices where id = $1', [r.device_id]))
      .toEqual({ status: 'removed', removed: true });
  });

  it('refuses what it cannot record, by name', async () => {
    await expect(recognise('heat_pump_x', 0.5)).rejects.toThrow(/^device_type_unknown/);
    await expect(recognise('heat_pump', 1.5)).rejects.toThrow(/^invalid_value/);
    await expect(one(db, `select * from consumption.recognise_device($1, 'heat_pump', 'nobody', 0.5)`, [home])).rejects.toThrow(/^source_unknown/);
  });
});
