// @nexgen-os/switchgrid, offline: the answers of the v0 API are fixtures
// built after the examples of its specification, the R63 file one of
// @nexgen-os/enedis-r6x. Then the whole path on a database with the fr
// pack: the mandate checked, the order placed, the file read with the hub's
// conventions, the series of the meter stored with their quality.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { collectMeterReadings, registerSource, type Db, type MeterMandate } from '@nexgen-os/core';
import { mandateStatusOf, switchgrid, switchgridSource, webhookTokenMatches, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
const R63 = readFileSync(new URL('../../../formats/enedis-r6x/tests/fixtures/r63-5min-reactive-outage.json', import.meta.url), 'utf8');

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }

/** A fake API: answers by method and path, in order for a path answered several times; records every call. */
function fakeApi(routes: Record<string, unknown[]>): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const key = `${method} ${url.replace(/\?.*$/, '')}`;
    const queue = routes[key];
    if (!queue || queue.length === 0) return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${key}` };
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, status: 200, json: async () => answer, text: async () => (typeof answer === 'string' ? answer : JSON.stringify(answer)) };
  };
  return { fetch, calls };
}

const API = 'https://api.switchgrid.tech';
const FILE = 'GET https://files.switchgrid.example/req-0001/r63-1.json';
const mandate: MeterMandate = {
  id: 'm-1', operator: 'enedis', scope: ['load_curve'], granularity: 'PT5M', data_from: null, data_to: null, valid_to: null,
  external_reference: '6f2c1d3e-0000-4000-8000-000000000001',
};
const hub = { operator: 'enedis', time_zone: 'Europe/Paris', quality_codes: { R: 0, D: 100, P: 102, S: 103, T: 104, F: 105, G: 106, missing: 3 }, sources: [], history_months: 24, steps: [] };

describe('the API v0', () => {
  it('speaks v0 with the bearer token, in the test world when the connector row says so', async () => {
    const api = fakeApi({ [`POST ${API}/ask`]: [json('ask-pending.json')], [`GET ${API}/ask/6f2c1d3e-0000-4000-8000-000000000001`]: [json('ask-granted.json')] });
    const client = switchgrid({ token: 'test-token', test: true, fetch: api.fetch });
    const asked = await client.ask({ contracts: [{ contractId: 'c-1' }] });
    expect(asked).toMatchObject({ status: 'PENDING_USER_ACTION', signingUrl: 'https://app.switchgrid.tech/consent/6f2c1d3e-0000-4000-8000-000000000001', granted: [] });
    expect(api.calls[0]!.headers).toMatchObject({ Authorization: 'Bearer test-token', 'x-api-version': 'v0', 'switchgrid-test-env': 'true' });
    expect((await client.askStatus(asked.id)).granted).toEqual(['00000000000002']);
  });

  it('refuses to be built without its token, and names an answer it is refused', async () => {
    expect(() => switchgrid({ token: '' })).toThrow(/secret_not_found/);
    const client = switchgrid({ token: 't', fetch: async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad token' }) });
    await expect(client.askStatus('x')).rejects.toThrow(/source_unauthorised: switchgrid 401/);
  });

  it('follows a mandate on contract_access_granted, not on accepted, and ignores the events it does not know', () => {
    expect((json('webhooks.json') as { tag: string }[]).map((e) => [e.tag, mandateStatusOf(e)])).toEqual([
      ['ask.verified', null], ['ask.accepted', null], ['ask.contract_access_granted', 'approved'],
      ['order.request_success', null], ['ask.revoked', 'revoked'], ['ask.something_new', null],
    ]);
    expect([webhookTokenMatches('s3cret', 's3cret'), webhookTokenMatches('s3cre', 's3cret'), webhookTokenMatches(null, 's3cret')]).toEqual([true, false, false]);
  });
});

describe('reading a meter', () => {
  const routes = () => ({
    [`POST ${API}/integration/enedis/order`]: [json('order-pending.json'), { ...(json('order-injection-failed.json') as object), status: 'PENDING' }],
    [`GET ${API}/integration/enedis/order/ord-0001`]: [json('order-pending.json'), json('order-success.json')],
    [`GET ${API}/integration/enedis/order/ord-0002`]: [json('order-injection-failed.json')],
    [FILE]: [R63],
  });

  it('refuses without the mandate the check returned', async () => {
    const client = switchgrid({ token: 't', fetch: fakeApi(routes()).fetch });
    await expect(client.readings({ identifier: '00000000000002', scheme: 'prm' }, '2026-06-01', '2026-06-11')).rejects.toThrow(/mandate_missing/);
    await expect(client.readings({ identifier: '00000000000002', scheme: 'prm' }, '2026-06-01', '2026-06-11', { mandate: { ...mandate, external_reference: null }, hub }))
      .rejects.toThrow(/mandate_missing: .* names no Switchgrid ask/);
  });

  it('orders an R63 per direction under the ask, waits, reads the file with the hub and keeps the offtake when injection fails', async () => {
    const api = fakeApi(routes());
    const client = switchgrid({ token: 't', fetch: api.fetch, poll: { intervalMs: 0 } });
    const series = await client.readings({ identifier: '00000000000002', scheme: 'prm', direction: 'both' }, '2026-06-01', '2026-06-11', { mandate, hub });
    const orders = api.calls.filter((c) => c.method === 'POST');
    expect(orders.map((c) => c.body)).toEqual([
      { askId: mandate.external_reference, requests: [{ prms: ['00000000000002'], type: 'R63', direction: 'SOUTIRAGE', since: '2026-06-01', until: '2026-06-11' }] },
      { askId: mandate.external_reference, requests: [{ prms: ['00000000000002'], type: 'R63', direction: 'INJECTION', since: '2026-06-01', until: '2026-06-11' }] },
    ]);
    expect(series.map((s) => [s.quantity_code, s.value_kind, s.step, s.unit, s.values.length])).toEqual([
      ['offtake_power', 'interval', '5 minutes', 'W', 24],
      ['reactive_power_inductive', 'interval', '5 minutes', 'V-A_Reactive', 24],
    ]);
    expect(series[0]!.values.slice(9, 14).map((v) => v.quality)).toEqual([105, 103, 104, 106, 3]);
  });

  it('asks R63_SYNC for a week or less', async () => {
    const api = fakeApi(routes());
    await switchgrid({ token: 't', fetch: api.fetch, poll: { intervalMs: 0 } })
      .readings({ identifier: '00000000000002', scheme: 'prm' }, '2026-06-10', '2026-06-11', { mandate, hub });
    expect((api.calls[0]!.body as { requests: { type: string }[] }).requests[0]!.type).toBe('R63_SYNC');
  });
});

describe('the whole path on a database with the fr pack', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase(['grid'], ['fr']);
  });
  afterAll(async () => {
    await db.close();
  });

  it('checks the mandate, reads through Switchgrid, and keeps the series on the meter with the pack quality codes', async () => {
    await registerSource(db as unknown as Db, switchgridSource);
    expect(await one(db, `select auth, redistributable, countries, published_by from sources where code = 'switchgrid'`))
      .toEqual({ auth: 'mandate', redistributable: false, countries: ['FR'], published_by: '@nexgen-os/switchgrid' });
    // The country is the one the source row serves, as data.
    const country = switchgridSource.countries![0]!;
    const org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A study', kind: 'study', country });
    const site = (await one<{ id: string }>(db, `select join_project($1, 'Warehouse', $2) id`, [project, { country, region: `${country}-75C` }])).id;
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, '00000000000002', 'prm') id`, [site])).id;
    const connector = await insert(db, 'connectors', { organisation_id: org, source_code: 'switchgrid', name: 'Switchgrid', secret_ref: 'switchgrid_token', config: { environment: 'test' } });
    const request = { connectorId: connector, meterId: meter, from: '2026-06-01', to: '2026-06-11', step: 'PT5M', on: '2026-06-11' };
    const client = switchgrid({ token: 't', fetch: fakeApi(routes()).fetch, poll: { intervalMs: 0 } });
    await expect(collectMeterReadings(db as unknown as Db, client, request)).rejects.toThrow(/mandate_missing/);

    const id = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT5M', '{load_curve}', 'study', '2026-06-01', null, '2024-06-01', null, 'enedis') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true, null, $2)`, [id, mandate.external_reference]);
    const { stored } = await collectMeterReadings(db as unknown as Db, client, request);
    expect(stored.map((s) => [s.quantity_code, s.inserted])).toEqual([['offtake_power', 24], ['reactive_power_inductive', 24], ['injection_power', 4]]);
    const outage = await db.query(`select at, value, quality from series_values where series_id = $1 order by at limit 3 offset 9`, [stored[0]!.seriesId]);
    expect(outage.rows).toEqual([
      { at: new Date('2026-06-10T08:45:00Z'), value: 52.9, quality: 105 },
      { at: new Date('2026-06-10T08:50:00Z'), value: 53, quality: 103 },
      { at: new Date('2026-06-10T08:55:00Z'), value: 53.1, quality: 104 },
    ]);
    expect(await one(db, `select unit from quantities q join series s on s.quantity_code = q.code where s.id = $1`, [stored[1]!.seriesId])).toEqual({ unit: 'KiloV-A_Reactive' });
  });

  function routes() {
    return {
      [`POST ${API}/integration/enedis/order`]: [json('order-pending.json')],
      [`GET ${API}/integration/enedis/order/ord-0001`]: [json('order-success.json')],
      [FILE]: [R63],
    };
  }
});
