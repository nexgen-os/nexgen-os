// @nexgen-os/zaptec, offline: the answers of the cloud API are fixtures
// built on the shapes of its published OpenAPI description
// (https://api.zaptec.com/swagger/v1/swagger.json). Then the whole path on a
// database with the `charging` module: the sessions of a charger recorded
// once, their energy one register of the device, read back by hour.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { registerSource, resample } from '@nexgen-os/core';
import { collectZaptecSessions, instantOf, sessionsOfZaptec, stateOfZaptec, zaptec, zaptecSource, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

interface Call { method: string; url: string; headers: Record<string, string>; body?: string }

/** A fake API: answers by method and path (and page or cursor), records every call. */
function fakeApi(answer: (method: string, url: URL) => { status?: number; body: unknown } | undefined): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    const a = answer(method, new URL(url));
    if (!a) return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${method} ${url}` };
    const status = a.status ?? 200;
    return { ok: status < 400, status, json: async () => a.body, text: async () => JSON.stringify(a.body) };
  };
  return { fetch, calls };
}

const CHARGER = '0b6e1c2a-7d1f-4f8e-9a3b-111111111111';

const cloud = () => fakeApi((method, url) => {
  if (method === 'POST' && url.pathname === '/oauth/token') return { body: json('token.json') };
  if (url.pathname === '/api/chargers') return { body: json(`chargers-page-${url.searchParams.get('PageIndex')}.json`) };
  if (url.pathname === `/api/chargers/${CHARGER}/state`) return { body: json('state.json') };
  if (url.pathname === '/api/sessions/archived') return { body: json(url.searchParams.get('cursor') ? 'sessions-page-2.json' : 'sessions-page-1.json') };
  return undefined;
});

describe('the account', () => {
  it('signs in once with the owner\'s account, then reads with its token', async () => {
    const api = cloud();
    const client = zaptec({ username: 'owner@example.org', password: 'fixture-password', fetch: api.fetch });
    const chargers = await client.chargers();
    expect(chargers.map((c) => [c.id, c.device_id, c.active, c.online])).toEqual([
      [CHARGER, 'ZAP000101', true, true],
      ['0b6e1c2a-7d1f-4f8e-9a3b-222222222222', 'ZAP000102', false, null],
    ]);
    await client.state(CHARGER);
    const token = api.calls.filter((c) => c.url.endsWith('/oauth/token'));
    expect(token).toHaveLength(1);
    expect(new URLSearchParams(token[0]!.body)).toEqual(new URLSearchParams({ grant_type: 'password', username: 'owner@example.org', password: 'fixture-password' }));
    expect(api.calls.filter((c) => c.method === 'GET').every((c) => c.headers.Authorization === 'Bearer fixture-access-token')).toBe(true);
  });

  it('asks a new token when the one it holds expires, or is revoked', async () => {
    let clock = 0;
    let revoked = true;
    const api = fakeApi((method, url) => {
      if (method === 'POST') return { body: { access_token: 't', expires_in: 3600 } };
      if (url.pathname.endsWith('/state')) {
        if (revoked) {
          revoked = false;
          return { status: 401, body: 'expired' };
        }
        return { body: [] };
      }
      return undefined;
    });
    const client = zaptec({ username: 'u', password: 'p', fetch: api.fetch, now: () => clock });
    await client.state(CHARGER);
    expect(api.calls.map((c) => c.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
    await client.state(CHARGER);
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    clock = 3600_000;
    await client.state(CHARGER);
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(3);
  });

  it('refuses without an account, and names what the cloud refuses', async () => {
    expect(() => zaptec({ username: '', password: 'p' })).toThrow(/secret_not_found/);
    const wrong = zaptec({ username: 'u', password: 'wrong', fetch: fakeApi(() => ({ status: 400, body: { error: 'invalid_grant' } })).fetch });
    await expect(wrong.chargers()).rejects.toThrow(/source_unauthorised: zaptec refuses the account/);
    const forbidden = zaptec({ username: 'u', password: 'p', fetch: fakeApi((m) => (m === 'POST' ? { body: { access_token: 't' } } : { status: 403, body: 'not an owner' })).fetch });
    await expect(forbidden.state(CHARGER)).rejects.toThrow(/source_unauthorised: zaptec 403/);
    const down = zaptec({ username: 'u', password: 'p', fetch: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(down.chargers()).rejects.toThrow(/source_unavailable: zaptec does not answer/);
  });
});

describe('the state of a charger', () => {
  it('gives power, voltage and current at their own stamps, and the operation mode in words', async () => {
    const state = await zaptec({ username: 'u', password: 'p', fetch: cloud().fetch }).state(CHARGER);
    expect(state.operation_mode).toEqual({ mode: 'connected_charging', at: '2026-11-10T20:41:02.000Z' });
    expect(state.series.map((s) => [s.quantity_code, s.name, s.unit, s.values[0]!.at, s.values[0]!.value])).toEqual([
      ['voltage', 'L1', 'V', '2026-11-10T21:04:10.310Z', 231.4],
      ['voltage', 'L2', 'V', '2026-11-10T21:04:10.310Z', 229.8],
      ['voltage', 'L3', 'V', '2026-11-10T21:04:10.310Z', 230.6],
      ['current', 'L1', 'A', '2026-11-10T21:04:12.000Z', 15.9],
      ['current', 'L2', 'A', '2026-11-10T21:04:12.000Z', 16],
      ['consumption_power', null, 'W', '2026-11-10T21:04:15.000Z', 11021.7],
    ]);
    expect(state.series.every((s) => s.value_kind === 'instant' && s.step === null)).toBe(true);
    expect(state.skipped).toEqual([{ observation: 509, reason: 'value_invalid' }]);
  });

  it('reads a stamp without an offset as UTC, and refuses one that is not a date', () => {
    expect(instantOf('2026-11-10T21:04:10.31')).toBe('2026-11-10T21:04:10.310Z');
    expect(instantOf('2026-11-10T22:04:10+01:00')).toBe('2026-11-10T21:04:10.000Z');
    expect(instantOf('yesterday')).toBeNull();
    expect(stateOfZaptec([{ stateId: 513, timestamp: 'soon', valueAsString: '1' }]).skipped).toEqual([{ observation: 513, reason: 'stamp_invalid' }]);
  });
});

describe('the sessions of a charger', () => {
  it('reads every page, skips a voided session, and keeps an untrusted clock\'s session without its readings', async () => {
    const api = cloud();
    const read = await zaptec({ username: 'u', password: 'p', fetch: api.fetch }).sessions({ chargerId: CHARGER, from: '2026-11-09T00:00:00Z', to: '2026-11-11T00:00:00Z' });
    const first = new URL(api.calls.find((c) => c.url.includes('/archived'))!.url).searchParams;
    expect(Object.fromEntries(first)).toEqual({ chargerId: CHARGER, from: '2026-11-09T00:00:00Z', to: '2026-11-11T00:00:00Z', pageSize: '200' });
    expect(api.calls.filter((c) => c.url.includes('cursor=fixture-cursor-2'))).toHaveLength(1);

    expect(read.sessions.map((s) => s.record.transaction_id.slice(-1))).toEqual(['1', '3', '4']);
    expect(read.skipped).toEqual([
      { session: 'a1000000-0000-4000-8000-000000000002', reason: 'voided' },
      { session: 'a1000000-0000-4000-8000-000000000004', reason: 'clock_unreliable' },
    ]);
    const [s1, s3, s4] = read.sessions;
    expect(s1!.record).toEqual({
      transaction_id: 'a1000000-0000-4000-8000-000000000001', started_at: '2026-11-09T18:10:00.000Z', ended_at: '2026-11-09T20:30:00.000Z',
      energy_kwh: 15.4, id_token: 'Blue card',
      metadata: { device_id: 'ZAP000101', installation_id: '5c0d3e4f-0000-4000-8000-0000000000aa', external_id: null, firmware: '3.4.1.2',
        offline: false, reliable_clock: true, signed: true, aborted: false, stopped_by_rfid: false },
    });
    // The person who authorised it is not read.
    expect(JSON.stringify(s1)).not.toMatch(/someone@example.org|Some One/);
    expect(s1!.energy).toEqual([
      { at: '2026-11-09T18:10:00.000Z', value: 0 },
      { at: '2026-11-09T19:00:00.000Z', value: 9.1 },
      { at: '2026-11-09T20:00:00.000Z', value: 14.8 },
      { at: '2026-11-09T20:30:00.000Z', value: 15.4 },
    ]);
    expect(s3!.record.metadata.external_id).toBe('4711');
    expect(s3!.energy).toEqual([{ at: '2026-11-10T07:00:00.000Z', value: 0 }, { at: '2026-11-10T08:00:00.000Z', value: 3.2 }]);
    expect(s4!.energy).toEqual([]);
  });

  it('skips a reading below the one before it, or out of the session', () => {
    const read = sessionsOfZaptec([{
      id: 's', startDateTime: '2026-11-10T10:00:00Z', endDateTime: '2026-11-10T11:00:00Z', energy: 2,
      energyDetails: [{ timestamp: '2026-11-10T10:20:00Z', energy: 1.5 }, { timestamp: '2026-11-10T10:40:00Z', energy: 1.2 }, { timestamp: '2026-11-10T12:00:00Z', energy: 3 }],
    }, { id: 'broken', startDateTime: null, endDateTime: '2026-11-10T11:00:00Z' }]);
    expect(read.sessions[0]!.energy.map((p) => p.value)).toEqual([0, 1.5, 2]);
    expect(read.skipped).toEqual([{ session: 's', reason: 'value_invalid' }, { session: 's', reason: 'value_invalid' }, { session: 'broken', reason: 'stamp_invalid' }]);
  });
});

describe('collected on a charger of the charging module', () => {
  let db: PGlite;
  let org: string;
  let charger: string;

  beforeAll(async () => {
    db = await freshDatabase(['actions', 'charging']);
    org = await organisation(db, 'A household');
    await db.query(`insert into currencies (code, name) values ('ZZZ', 'Testland currency') on conflict do nothing`);
    await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by)
                    values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A house', kind: 'individual_self_consumption', country: 'ZZ' });
    const house = await insert(db, 'participants', { organisation_id: org, project_id: project, name: 'The house', country: 'ZZ', time_zone: 'UTC', segment: 'individual' });
    charger = (await one<{ id: string }>(db, `select install_device($1, 'charger', 'Garage', null, 11, '2026-01-01') id`, [house])).id;
    await registerSource(db, zaptecSource);
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses a charger the module does not describe', async () => {
    const client = zaptec({ username: 'u', password: 'p', fetch: cloud().fetch });
    await expect(collectZaptecSessions(db, client, { organisationId: org, deviceId: charger, chargerId: CHARGER, from: '2026-11-09T00:00:00Z', to: '2026-11-11T00:00:00Z' }))
      .rejects.toThrow(/charger_not_described/);
  });

  it('records each session once and the energy as one register, read back by hour and by day', async () => {
    await insert(db, 'charging.devices', { id: charger, max_power_kw: 11 });
    const client = zaptec({ username: 'u', password: 'p', fetch: cloud().fetch });
    const request = { organisationId: org, deviceId: charger, chargerId: CHARGER, from: '2026-11-09T00:00:00Z', to: '2026-11-11T00:00:00Z' };
    const first = await collectZaptecSessions(db, client, request);
    expect(first.sessions).toHaveLength(3);
    expect(first.energy!.inserted).toBe(6);

    const again = await collectZaptecSessions(db, client, request);
    expect(again.sessions).toEqual(first.sessions);
    expect(again.energy!.seriesId).toBe(first.energy!.seriesId);
    expect((await one<{ n: number }>(db, 'select count(*)::int n from charging.sessions')).n).toBe(3);

    const rows = (await db.query<Record<string, unknown>>(`select transaction_id, energy_kwh, id_token, source, source_ref, metadata->>'signed' signed
                                                             from charging.sessions order by started_at`)).rows;
    expect(rows.map((r) => [String(r.transaction_id).slice(-1), r.energy_kwh, r.id_token, r.source, r.source_ref, r.signed])).toEqual([
      ['1', 15.4, 'Blue card', 'station', 'ZAP000101', 'true'],
      ['3', 3.2, null, 'station', 'ZAP000101', 'false'],
      ['4', 2, null, 'station', 'ZAP000101', 'false'],
    ]);
    const series = await one<Record<string, unknown>>(db, 'select quantity_code, value_kind, kind, source_code from series where id = $1', [first.energy!.seriesId]);
    expect(series).toEqual({ quantity_code: 'consumption_energy', value_kind: 'cumulative', kind: 'measured', source_code: 'zaptec' });

    const hours = await resample(db, first.energy!.seriesId, '2026-11-09T18:00:00Z', '2026-11-10T09:00:00Z', '1 hour');
    expect(hours.map((b) => [b.bucket, Math.round(b.value! * 100) / 100])).toEqual([
      ['2026-11-09T18:00:00.000Z', 9.1],
      ['2026-11-09T19:00:00.000Z', 5.7],
      ['2026-11-09T20:00:00.000Z', 0.6],
      ['2026-11-10T07:00:00.000Z', 3.2],
    ]);
    const days = await resample(db, first.energy!.seriesId, '2026-11-09T00:00:00Z', '2026-11-11T00:00:00Z', '1 day', { timeZone: 'UTC' });
    expect(days.map((b) => Math.round(b.value! * 100) / 100)).toEqual([15.4, 3.2]);
  });
});
