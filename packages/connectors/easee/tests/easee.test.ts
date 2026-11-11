// @nexgen-os/easee, offline: the answers of the cloud API are fixtures built
// on the shapes of its published OpenAPI description
// (https://developer.easee.com/openapi/easee-cloud-api.json). Then the whole
// path on a database with the `charging` module: the sessions of a charger
// recorded once, its lifetime energy register and its power as series of
// the device, read back by hour and by day.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { registerSource, resample } from '@nexgen-os/core';
import { collectEasee, easee, easeeSource, seriesOfEasee, sessionsOfEasee, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

interface Call { method: string; url: string; headers: Record<string, string>; body?: string }

/** A fake API: answers by method and path, records every call. */
function fakeApi(answer: (method: string, path: string) => { status?: number; body: unknown } | undefined): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    const a = answer(method, decodeURIComponent(new URL(url).pathname));
    if (!a) return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${method} ${url}` };
    const status = a.status ?? 200;
    return { ok: status < 400, status, json: async () => a.body, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
}

const CHARGER = 'EH000101';
const FROM = '2026-11-09T00:00:00Z';
const TO = '2026-11-11T00:00:00Z';

const cloud = () => fakeApi((method, path) => {
  if (method === 'POST' && path === '/api/accounts/login') return { body: json('login.json') };
  if (path === '/api/chargers') return { body: json('chargers.json') };
  if (path === `/api/chargers/${CHARGER}/observations/124/${FROM}/${TO}`) return { body: json('lifetime-energy.json') };
  if (path === `/api/chargers/${CHARGER}/observations/120/${FROM}/${TO}`) return { body: json('total-power.json') };
  if (path === `/api/sessions/charger/${CHARGER}/sessions/${FROM}/${TO}`) return { body: json('sessions.json') };
  return undefined;
});

describe('the account', () => {
  it('signs in once with the owner\'s account, then reads with its token', async () => {
    const api = cloud();
    const client = easee({ username: 'owner@example.org', password: 'fixture-password', fetch: api.fetch });
    expect(await client.chargers()).toEqual([{ id: CHARGER, name: 'Garage' }]);
    await client.sessions({ chargerId: CHARGER, from: FROM, to: TO });
    const login = api.calls.filter((c) => c.method === 'POST');
    expect(login).toHaveLength(1);
    expect(JSON.parse(login[0]!.body!)).toEqual({ userName: 'owner@example.org', password: 'fixture-password' });
    expect(api.calls.filter((c) => c.method === 'GET').every((c) => c.headers.Authorization === 'Bearer fixture-access-token')).toBe(true);
  });

  it('renews an expired token with its refresh token, and signs in again when that is refused', async () => {
    let clock = 0;
    let refreshAccepted = true;
    const api = fakeApi((_method, path) => {
      if (path === '/api/accounts/login') return { body: { accessToken: 'from-login', expiresIn: 3600, refreshToken: 'r1' } };
      if (path === '/api/accounts/refresh_token') return refreshAccepted ? { body: { accessToken: 'from-refresh', expiresIn: 3600, refreshToken: 'r2' } } : { status: 400, body: 'expired' };
      if (path === '/api/chargers') return { body: [] };
      return undefined;
    });
    const client = easee({ username: 'u', password: 'p', fetch: api.fetch, now: () => clock });
    await client.chargers();
    clock = 3600_000;
    await client.chargers();
    expect(JSON.parse(api.calls.find((c) => c.url.endsWith('/refresh_token'))!.body!)).toEqual({ refreshToken: 'r1' });
    expect(api.calls.at(-1)!.headers.Authorization).toBe('Bearer from-refresh');
    refreshAccepted = false;
    clock = 7200_000;
    await client.chargers();
    expect(api.calls.map((c) => c.url.replace('https://api.easee.com', ''))).toEqual([
      '/api/accounts/login', '/api/chargers', '/api/accounts/refresh_token', '/api/chargers',
      '/api/accounts/refresh_token', '/api/accounts/login', '/api/chargers',
    ]);
  });

  it('refuses without an account, and names what the cloud refuses', async () => {
    expect(() => easee({ username: 'u', password: '' })).toThrow(/secret_not_found/);
    const wrong = easee({ username: 'u', password: 'wrong', fetch: fakeApi(() => ({ status: 400, body: 'bad credentials' })).fetch });
    await expect(wrong.chargers()).rejects.toThrow(/source_unauthorised: easee 400 on \/api\/accounts\/login/);
    const limited = easee({ username: 'u', password: 'p', fetch: fakeApi((m) => (m === 'POST' ? { body: { accessToken: 't' } } : { status: 429, body: 'too many' })).fetch });
    await expect(limited.chargers()).rejects.toThrow(/source_rate_limited: easee asks to wait before \/api\/chargers/);
    const down = easee({ username: 'u', password: 'p', fetch: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(down.chargers()).rejects.toThrow(/source_unavailable: easee does not answer/);
  });
});

describe('what a charger observed', () => {
  it('gives its lifetime energy register and its power, sorted, a stamp without an offset read as UTC', async () => {
    const read = await easee({ username: 'u', password: 'p', fetch: cloud().fetch }).observations({ chargerId: CHARGER, from: FROM, to: TO });
    expect(read.series.map((s) => [s.quantity_code, s.value_kind, s.unit, s.values.length])).toEqual([
      ['consumption_power', 'instant', 'KiloW', 2],
      ['consumption_energy', 'cumulative', 'KiloW-HR', 6],
    ]);
    expect(read.series[1]!.values[3]).toEqual({ at: '2026-11-09T21:00:00.000Z', value: 1215.4 });
    expect(read.skipped).toEqual([
      { observation: 120, at: 'not a date', reason: 'stamp_invalid' },
      { observation: 124, at: '2026-11-10T09:00:00.000Z', reason: 'value_invalid' },
    ]);
  });

  it('refuses an observation it does not map', () => {
    expect(() => seriesOfEasee(109, [])).toThrow(/observation_unknown/);
    expect(seriesOfEasee(124, []).series).toEqual([]);
  });
});

describe('the sessions of a charger', () => {
  it('reads each session from the car connected to the car disconnected, without its price', () => {
    const read = sessionsOfEasee(json('sessions.json') as unknown[]);
    expect(read.sessions[0]).toEqual({
      transaction_id: '3041', started_at: '2026-11-09T18:05:00.000Z', ended_at: '2026-11-09T21:40:00.000Z', energy_kwh: 15.4, id_token: '04A2B3C4D5E6F7',
      metadata: { energy_from: '2026-11-09T18:10:00.000Z', energy_to: '2026-11-09T20:30:00.000Z', charging_s: 8400, complete: true },
    });
    expect(JSON.stringify(read.sessions)).not.toMatch(/cost|price|currency|OCMF/i);
    expect(read.sessions[1]).not.toHaveProperty('ended_at');
    expect(read.skipped).toEqual([{ session: '3043', reason: 'stamp_invalid' }]);
  });
});

describe('collected on a charger of the charging module', () => {
  let db: PGlite;
  let org: string;
  let charger: string;
  const request = () => ({ organisationId: org, deviceId: charger, chargerId: CHARGER, from: FROM, to: TO });

  beforeAll(async () => {
    db = await freshDatabase(['actions', 'charging']);
    org = await organisation(db, 'A household');
    await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
    await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                    values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A house', kind: 'individual_self_consumption', country: 'ZZ' });
    const house = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'The house', country: 'ZZ', time_zone: 'UTC', segment: 'individual' });
    charger = (await one<{ id: string }>(db, `select install_device($1, 'charger', 'Garage', null, 11, '2026-01-01') id`, [house])).id;
    await registerSource(db, easeeSource);
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses a charger the module does not describe', async () => {
    await expect(collectEasee(db, easee({ username: 'u', password: 'p', fetch: cloud().fetch }), request())).rejects.toThrow(/charger_not_described/);
  });

  it('records each session once, and the register gives the energy of each hour and day', async () => {
    await insert(db, 'charging.devices', { id: charger, max_power_kw: 11 });
    const client = easee({ username: 'u', password: 'p', fetch: cloud().fetch });
    const first = await collectEasee(db, client, request());
    expect(first.sessions).toHaveLength(2);
    expect(first.series.map((s) => [s.quantity, s.inserted])).toEqual([['consumption_power', 2], ['consumption_energy', 6]]);

    const again = await collectEasee(db, client, request());
    expect(again.sessions).toEqual(first.sessions);
    expect(again.series.map((s) => s.seriesId)).toEqual(first.series.map((s) => s.seriesId));

    const rows = (await db.query<Record<string, unknown>>(`select transaction_id, ended_at is null open, energy_kwh, id_token, source, source_ref
                                                             from charging.sessions order by started_at`)).rows;
    expect(rows.map((r) => [r.transaction_id, r.open, r.energy_kwh, r.id_token, r.source, r.source_ref])).toEqual([
      ['3041', false, 15.4, '04A2B3C4D5E6F7', 'station', CHARGER],
      ['3042', true, 3.2, null, 'station', CHARGER],
    ]);

    const energy = first.series.find((s) => s.quantity === 'consumption_energy')!.seriesId;
    expect(await one(db, 'select value_kind, kind, source_code from series where id = $1', [energy])).toEqual({ value_kind: 'cumulative', kind: 'measured', source_code: 'easee' });
    const hours = await resample(db, energy, '2026-11-09T18:00:00Z', '2026-11-10T09:00:00Z', '1 hour');
    expect(hours.filter((b) => b.value! > 0).map((b) => [b.bucket, Math.round(b.value! * 100) / 100])).toEqual([
      ['2026-11-09T18:00:00.000Z', 9.1],
      ['2026-11-09T19:00:00.000Z', 5.7],
      ['2026-11-09T20:00:00.000Z', 0.6],
      ['2026-11-10T07:00:00.000Z', 3.2],
    ]);
    const days = await resample(db, energy, FROM, TO, '1 day', { timeZone: 'UTC' });
    expect(days.map((b) => Math.round(b.value! * 100) / 100)).toEqual([15.4, 3.2]);
  });
});
