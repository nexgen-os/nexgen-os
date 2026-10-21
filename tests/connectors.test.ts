// A weather forecast comes in from an open connector, lands on a site with
// its issue time, and the second issue replaces the first for the pages
// while the first stays readable; each kind of series has its one store;
// an organisation's connector to a source is a row of its own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { openMeteo } from '@nexgen-os/open-meteo';
import { storeSeries } from '@nexgen-os/core';
import type { Fetch } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation } from './helpers/db.js';

const answer = (temperature: number[], radiation: number[]) => ({
  latitude: 50.85, longitude: 4.35, timezone: 'UTC', hourly_units: { time: 'iso8601', temperature_2m: '°C', shortwave_radiation: 'W/m²' },
  hourly: { time: ['2026-10-14T10:00', '2026-10-14T11:00', '2026-10-14T12:00'], temperature_2m: temperature, shortwave_radiation: radiation },
});
const fetchWith = (body: unknown): Fetch => async () => ({ ok: true, status: 200, json: async () => body });

let db: PGlite;
let org: string;
let site: string;

beforeAll(async () => {
  db = await freshDatabase();
  org = await organisation(db, 'A cooperative', USER_A);
  await organisation(db, 'Another', USER_B);
  site = await insert(db, 'sites', { organisation_id: org, name: 'Hall', country: 'BE', time_zone: 'Europe/Brussels', geometry: { type: 'Point', coordinates: [4.35, 50.85] } });
});

afterAll(async () => {
  await db.close();
});

describe('the Open-Meteo connector', () => {
  it('maps the hourly answer to the core quantities, radiation shifted to the hour it covers', async () => {
    const provider = openMeteo({ fetch: fetchWith(answer([12.1, 13.4, 14.0], [120, 310, null as unknown as number])), now: () => new Date('2026-10-14T06:00:00Z') });
    const got = await provider.forecast({ lon: 4.35, lat: 50.85 }, { hours: 3 });
    expect(got.issued_at).toBe('2026-10-14T06:00:00.000Z');
    expect(got.series.map((s) => [s.quantity_code, s.value_kind, s.step, s.values.length])).toEqual([
      ['temperature', 'instant', '1 hour', 3],
      ['irradiance', 'interval', '1 hour', 2],
    ]);
    expect(got.series[0].values[0]).toEqual({ at: '2026-10-14T10:00:00.000Z', value: 12.1 });
    expect(got.series[1].values[0]).toEqual({ at: '2026-10-14T09:00:00.000Z', value: 120 });
  });
});

describe('a forecast on a site', () => {
  it('keeps every issue, shows the latest, and still answers for an earlier one', async () => {
    const first = await openMeteo({ fetch: fetchWith(answer([12, 13, 14], [100, 200, 300])), now: () => new Date('2026-10-14T00:00:00Z') }).forecast({ lon: 4.35, lat: 50.85 });
    const second = await openMeteo({ fetch: fetchWith(answer([11, 12, 13], [100, 200, 300])), now: () => new Date('2026-10-14T06:00:00Z') }).forecast({ lon: 4.35, lat: 50.85 });
    const target = { organisationId: org, objectKind: 'site', objectId: site, sourceCode: 'open_meteo', kind: 'forecast' as const };
    const a = await storeSeries(db, target, first.series[0], { issuedAt: first.issued_at });
    const b = await storeSeries(db, target, second.series[0], { issuedAt: second.issued_at });
    expect(b.seriesId).toBe(a.seriesId);
    const stored = await one<{ n: number; kind: string }>(db, `select count(*)::int n, min(s.kind) kind from forecast_values f join series s on s.id = f.series_id where f.series_id = $1`, [a.seriesId]);
    expect(stored).toEqual({ n: 6, kind: 'forecast' });

    const latest = await db.query<{ value: number }>(`select value from resample($1, '2026-10-14 10:00Z', '2026-10-14 13:00Z', '1 hour')`, [a.seriesId]);
    expect(latest.rows.map((r) => r.value)).toEqual([11, 12, 13]);
    const asKnownAt = await db.query<{ value: number }>(`select value from resample($1, '2026-10-14 10:00Z', '2026-10-14 13:00Z', '1 hour', null, '2026-10-14 03:00Z')`, [a.seriesId]);
    expect(asKnownAt.rows.map((r) => r.value)).toEqual([12, 13, 14]);
    const daily = await db.query<{ value: number; samples: number }>(`select value, samples from resample($1, '2026-10-14 00:00Z', '2026-10-15 00:00Z', '1 day')`, [a.seriesId]);
    expect(daily.rows).toEqual([{ value: 12, samples: 3 }]);
  });

  it('refuses a forecast in series_values and a measurement in forecast_values, by name', async () => {
    const forecast = await one<{ id: string }>(db, `select id from series where object_id = $1 and kind = 'forecast' limit 1`, [site]);
    await expect(db.query(`insert into series_values (series_id, at, value) values ($1, now(), 1)`, [forecast.id])).rejects.toThrow(/forecast_values_required/);
    const measured = await insert(db, 'series', { organisation_id: org, object_kind: 'site', object_id: site, quantity_code: 'temperature', kind: 'measured', value_kind: 'instant' });
    await expect(db.query(`insert into forecast_values (series_id, at, issued_at, value) values ($1, now(), now(), 1)`, [measured])).rejects.toThrow(/not_a_forecast/);
    await expect(storeSeries(db, { organisationId: org, objectKind: 'site', objectId: site, sourceCode: 'open_meteo', kind: 'forecast' }, { quantity_code: 'temperature', value_kind: 'instant', step: '1 hour', values: [] })).rejects.toThrow(/issued_at_required/);
  });

  it('replaces a measured value already present instead of refusing it', async () => {
    const target = { organisationId: org, objectKind: 'site', objectId: site, sourceCode: 'open_meteo', kind: 'measured' as const };
    const series = { quantity_code: 'irradiance', value_kind: 'interval' as const, step: '1 hour', values: [{ at: '2026-10-13T09:00:00Z', value: 100 }] };
    const { seriesId } = await storeSeries(db, target, series);
    await storeSeries(db, target, { ...series, values: [{ at: '2026-10-13T09:00:00Z', value: 150 }, { at: '2026-10-13T10:00:00Z', value: 200 }] });
    const r = await db.query<{ value: number }>(`select value from series_values where series_id = $1 order by at`, [seriesId]);
    expect(r.rows.map((x) => x.value)).toEqual([150, 200]);
  });
});

describe('a connectors row', () => {
  it('names the source and the credential, never the secret, and belongs to its organisation', async () => {
    const id = await insert(db, 'connectors', { organisation_id: org, source_code: 'open_meteo', name: 'Weather for the hall', config: { sites: [site] }, secret_ref: null });
    const mine = await asUser(db, USER_A, () => one<{ n: number }>(db, 'select count(*)::int n from connectors where id = $1', [id]));
    const theirs = await asUser(db, USER_B, () => one<{ n: number }>(db, 'select count(*)::int n from connectors where id = $1', [id]));
    expect([mine.n, theirs.n]).toEqual([1, 0]);
    await expect(insert(db, 'connectors', { organisation_id: org, source_code: 'open_meteo', name: 'Paused?', status: 'sleeping' })).rejects.toThrow(/connectors_status/);
    const retention = await one<{ redistributable: boolean; retention_days: number | null }>(db, `select redistributable, retention_days from sources where code = 'open_meteo'`);
    expect(retention).toEqual({ redistributable: true, retention_days: null });
  });
});
