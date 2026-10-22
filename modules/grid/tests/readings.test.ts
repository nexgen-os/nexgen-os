// Reading a meter under mandate: the one check (`grid.authorise_reading()`)
// asked through its twin in `@nexgen-os/core`, then the connector called
// with the mandate and the conventions of the hub from the pack's row, and
// what it brought kept as measured series of the meter with its source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  authoriseReading, collectMeterReadings, requireMandate, type Db, type MeterDataProvider, type MeterReadingOptions,
} from '@nexgen-os/core';
import { freshDatabase, insert, one, organisation } from '../../../tests/helpers/db.js';

let db: PGlite;
let meter: string;
let connector: string;
const seen: MeterReadingOptions[] = [];

// A connector of a hub under mandate, as every one is written: it refuses
// without the mandate, then reads the hub's flags from the pack's row.
const hub: MeterDataProvider = {
  source_code: 'zz_data_hub',
  async readings(_meter, _from, _to, options = {}) {
    requireMandate('zz_data_hub', options.mandate);
    seen.push(options);
    const flag = (letter: string) => options.hub!.quality_codes[letter]!;
    return [{
      quantity_code: 'offtake_power', value_kind: 'interval', step: '30 minutes', unit: 'W',
      values: [
        { at: '2026-01-01T00:00:00Z', value: 1200, quality: flag('M') },
        { at: '2026-01-01T00:30:00Z', value: 900, quality: flag('X') },
        { at: '2026-01-01T01:00:00Z', value: Number.NaN, quality: 3 },
      ],
    }];
  },
};

beforeAll(async () => {
  db = await freshDatabase(['grid']);
  const org = await organisation(db, 'A cooperative');
  await db.query(`insert into currencies (code, name) values ('ZZD', 'Testland currency') on conflict do nothing`);
  await db.query(`insert into countries (code, name, currency, region_level, published_by) values ('ZZ', 'Testland', 'ZZD', 'region', 'pack:zz')`);
  await db.query(`insert into regions (code, country, name, published_by) values ('ZZ-EA', 'ZZ', 'East', 'pack:zz')`);
  await db.query(`insert into grid.operators (code, name, kind, country, regions, meter_data, published_by) values
                    ('east_grid', 'East Grid', 'dso', 'ZZ', '{ZZ-EA}',
                     '{"time_zone": "Pacific/Auckland", "quality_codes": {"M": 0, "X": 100}, "sources": ["zz_data_hub"], "history_months": 24, "steps": ["PT30M"]}',
                     'pack:zz')`);
  await db.query(`insert into sources (code, name, kind, auth, published_by) values ('zz_data_hub', 'Testland meter data hub', 'api', 'mandate', 'pack:zz')`);
  const project = await insert(db, 'projects', { organisation_id: org, name: 'Testland community', kind: 'energy_community', country: 'ZZ' });
  const p = (await one<{ id: string }>(db, `select join_project($1, 'Dairy', '{"country": "ZZ", "region": "ZZ-EA"}') id`, [project])).id;
  meter = (await one<{ id: string }>(db, `select declare_meter($1, '541401200000000099', 'gs1_gsrn') id`, [p])).id;
  connector = await insert(db, 'connectors', { organisation_id: org, source_code: 'zz_data_hub', name: 'Meter data' });
});

afterAll(async () => {
  await db.close();
});

describe('reading a meter under mandate', () => {
  const request = () => ({ connectorId: connector, meterId: meter, from: '2026-01-01', to: '2026-01-02', step: 'PT30M', on: '2026-11-01' });

  it('is refused by name before the connector is called, and nothing is written', async () => {
    await expect(collectMeterReadings(db as unknown as Db, hub, request())).rejects.toThrow(/mandate_missing/);
    await expect(hub.readings({ identifier: 'x', scheme: 'gs1_gsrn' }, '2026-01-01', '2026-01-02')).rejects.toThrow(/mandate_missing/);
    expect(seen).toEqual([]);
    expect(await one(db, `select count(*)::int n from series where object_id = $1`, [meter])).toEqual({ n: 0 });
  });

  it('hands the connector the mandate and the hub of the pack, and keeps its readings on the meter with their quality', async () => {
    const id = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT30M', '{load_curve}', 'energy_management', '2026-10-01', '2027-10-01', '2025-10-01') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true, null, 'HUB-7')`, [id]);
    expect(await authoriseReading(db as unknown as Db, request())).toMatchObject({ id, operator: 'east_grid', external_reference: 'HUB-7', scope: ['load_curve'] });
    await expect(authoriseReading(db as unknown as Db, { ...request(), step: 'PT10M' })).rejects.toThrow(/mandate_scope/);

    const { mandate, stored } = await collectMeterReadings(db as unknown as Db, hub, request());
    expect(mandate?.id).toBe(id);
    expect(seen[0]!.hub).toEqual({
      operator: 'east_grid', time_zone: 'Pacific/Auckland', quality_codes: { M: 0, X: 100 }, sources: ['zz_data_hub'], history_months: 24, steps: ['PT30M'],
    });
    expect(stored).toHaveLength(1);
    const values = (await db.query(`select at, value, quality from series_values where series_id = $1 order by at`, [stored[0]!.seriesId])).rows;
    expect(values).toEqual([
      { at: new Date('2026-01-01T00:00:00Z'), value: 1.2, quality: 0 },
      { at: new Date('2026-01-01T00:30:00Z'), value: 0.9, quality: 100 },
      { at: new Date('2026-01-01T01:00:00Z'), value: Number.NaN, quality: 3 },
    ]);
    expect(await one(db, `select object_kind, quantity_code, kind, source_code from series where id = $1`, [stored[0]!.seriesId]))
      .toEqual({ object_kind: 'meter', quantity_code: 'offtake_power', kind: 'measured', source_code: 'zz_data_hub' });
  });

  it('refuses a connector of another source than its row', async () => {
    await expect(collectMeterReadings(db as unknown as Db, { ...hub, source_code: 'zz_other' }, request())).rejects.toThrow(/connector_source_mismatch/);
  });
});
