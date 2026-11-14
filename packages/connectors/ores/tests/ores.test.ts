// @nexgen-os/ores, offline: the answers of the API are fixtures built after
// the shapes the operator's guide gives (a list of `headpoint`s, the quarter
// hours under the physical meters of a digital meter or on the point of a
// meter read remotely), with made-up EANs, references and values. Then the
// whole path on a database with the be pack: the mandate checked, the
// energy read with the hub's conventions, the series of the meter stored.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { collectMeterReadings, type Db, type MeterMandate } from '@nexgen-os/core';
import { energySeries } from '@nexgen-os/fluvius';
import { certificateFetch, ores, oresMandateStatus, windows, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }

/** A fake operator: answers by method and path, a function choosing by the whole address; records every call. */
function fakeApi(routes: Record<string, unknown | ((url: URL) => unknown)>): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    const key = `${method} ${url.replace(/\?.*$/, '')}`;
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${key}` };
    const route = routes[key];
    const answer = typeof route === 'function' ? (route as (url: URL) => unknown)(new URL(url)) : route;
    return { ok: true, status: 200, json: async () => answer, text: async () => JSON.stringify(answer) };
  };
  return { fetch, calls };
}

const API = 'https://edap.ores.be/b2b/tpda/v1/api/external/v1';
const EAN = '541449000000000011';
const REMOTE = '541449000000000028';
const credentials = { subscriptionKey: 'sub-1' };
const mandate: MeterMandate = {
  id: 'm-1', operator: 'ores', scope: ['load_curve'], granularity: 'PT15M', data_from: null, data_to: null, valid_to: null, external_reference: 'REF-0001',
};
const hub = { operator: 'ores', time_zone: 'Europe/Brussels', quality_codes: { READ: 0, VAL: 0, EST: 1, NVAL: 100 }, sources: [], history_months: 36, steps: ['PT15M'] };
const routes = () => ({
  [`GET ${API}/mandates`]: json('mandates.json'),
  [`GET ${API}/mandates/energy`]: (url: URL) => (url.searchParams.get('from')! < '2026-06-16' ? json('energy-digital.json') : json('energy-second-week.json')),
  [`POST ${API}/shortUrlIdentifier`]: json('short-url.json'),
});

describe('the API for energy service providers', () => {
  it('calls with the subscription key, and lists the mandates of a reference with what each status means', async () => {
    const api = fakeApi(routes());
    const mandates = await ores({ credentials, fetch: api.fetch }).mandates('REF-0001', EAN);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toBe(`${API}/mandates?referenceNumber=REF-0001&ean=${EAN}`);
    expect(api.calls[0]!.headers).toEqual({ 'Ocp-Apim-Subscription-Key': 'sub-1', Accept: 'application/json' });
    expect(mandates.map((m) => [m.status, m.renewalStatus, m.ean, m.energyType, m.dataServiceType, oresMandateStatus(m)])).toEqual([
      ['Approved', null, EAN, 'E', 'HourlyQuarterHourly', 'approved'],
      // A renewal the customer let pass ends the mandate for new readings.
      ['Approved', 'Expired', EAN, 'E', 'Daily', 'expired'],
      ['Rejected', null, REMOTE, 'G', 'Daily', 'refused'],
      ['Finished', 'RenewalRequested', null, 'E', 'Daily', 'expired'],
    ]);
    expect(mandates[0]!.mandateExpirationDate).toBe('2028-01-26T00:00:00Z');
    expect(oresMandateStatus({ status: 'Something new', renewalStatus: null })).toBeNull();
  });

  it('refuses to be built without its key or with half a certificate, and names an answer it is refused', async () => {
    expect(() => ores({ credentials: { subscriptionKey: '' } })).toThrow(/secret_not_found: ores needs the subscription key/);
    expect(() => ores({ credentials: { subscriptionKey: 's', certificate: 'pem' } })).toThrow(/secret_not_found: ores needs the certificate and its private key/);
    expect(() => ores({ credentials: { subscriptionKey: 's', certificate: 'not a pem', privateKey: 'not a key' } })).toThrow(/certificate_unreadable/);
    expect(() => certificateFetch('not a pem', 'not a key')).toThrow(/certificate_unreadable/);
    const refused: HttpFetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad key' });
    await expect(ores({ credentials, fetch: refused }).mandates('REF-0001')).rejects.toThrow(/source_unauthorised: ores 401 on \/mandates: bad key/);
    const down: HttpFetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'maintenance' });
    await expect(ores({ credentials, fetch: down }).mandates('REF-0001')).rejects.toThrow(/source_unavailable: ores 503 on GET \/mandates/);
    await expect(ores({ credentials, fetch: fakeApi(routes()).fetch }).mandates('R'.repeat(36))).rejects.toThrow(/invalid_reference/);
  });

  it('asks a consent link under the contract, dates to the second, and gives the page of My ORES', async () => {
    const api = fakeApi(routes());
    const request = { referenceNumber: 'REF-0004', flow: 'B2C' as const, dataPeriodFrom: '2025-01-01T00:00:00.000Z', numberOfEans: 3 };
    await expect(ores({ credentials, fetch: api.fetch }).consentLink(request)).rejects.toThrow(/contract_number_required/);
    const client = ores({
      credentials, contractNumber: '00000000-0000-0000-0000-000000000000', returnUrlSuccess: 'https://provider.example/done',
      returnUrlFailed: 'https://provider.example/later', fetch: api.fetch,
    });
    expect(await client.consentLink(request)).toEqual({ id: '0381bcae55644c32b', url: 'https://www.myores.be/tpda/0381bcae55644c32b', validTo: '2026-06-16T06:00:00Z' });
    expect(JSON.parse(api.calls.at(-1)!.body!)).toEqual({
      dataAccessContractNumber: '00000000-0000-0000-0000-000000000000', referenceNumber: 'REF-0004', flow: 'B2C',
      // No end: the customer chooses it.
      dataServices: [{ dataServiceType: 'HOURLY_QUARTER_HOURLY', dataPeriodFrom: '2025-01-01T00:00:00Z' }],
      numberOfEans: 3, returnUrlSuccess: 'https://provider.example/done', returnUrlFailed: 'https://provider.example/later',
    });
    await expect(client.consentLink({ ...request, numberOfEans: 1001 })).rejects.toThrow(/invalid_parameter/);
    await expect(client.consentLink({ ...request, referenceNumber: '' })).rejects.toThrow(/invalid_reference/);
  });
});

describe('reading a meter', () => {
  it('refuses without the mandate the check returned or its reference, another step, or a hub without its zone', async () => {
    const client = ores({ credentials, fetch: fakeApi(routes()).fetch });
    const meter = { identifier: EAN, scheme: 'gs1_gsrn' };
    await expect(client.readings(meter, '2026-06-10', '2026-06-11')).rejects.toThrow(/mandate_missing/);
    await expect(client.readings(meter, '2026-06-10', '2026-06-11', { mandate: { ...mandate, external_reference: null }, hub })).rejects.toThrow(/mandate_reference_missing/);
    await expect(client.readings(meter, '2026-06-10', '2026-06-11', { mandate, hub, step: 'PT1H' })).rejects.toThrow(/step_unsupported/);
    await expect(client.readings(meter, '2026-06-10', '2026-06-11', { mandate, hub: { ...hub, time_zone: null } })).rejects.toThrow(/time_zone_required/);
    await expect(client.readings({ identifier: '5414', scheme: 'gs1_gsrn' }, '2026-06-10', '2026-06-11', { mandate, hub })).rejects.toThrow(/invalid_identifier/);
  });

  it('asks the hub\'s days by reference and EAN and gives offtake and injection, each state by the hub\'s table', async () => {
    const api = fakeApi(routes());
    const series = await ores({ credentials, fetch: api.fetch })
      .readings({ identifier: EAN, scheme: 'gs1_gsrn', direction: 'both' }, '2026-06-10', '2026-06-11', { mandate, hub });
    expect(api.calls).toHaveLength(1);
    expect(Object.fromEntries(new URL(api.calls[0]!.url).searchParams)).toEqual({
      referenceNumber: 'REF-0001', ean: EAN, granularity: 'hourlyQuarterHourly', periodType: 'readTime', from: '2026-06-09T22:00:00Z', to: '2026-06-10T22:00:00Z',
    });
    expect(series.map((s) => [s.quantity_code, s.value_kind, s.step, s.unit, s.values.length])).toEqual([
      ['offtake_energy', 'interval', '15 minutes', 'kWh', 4],
      ['injection_energy', 'interval', '15 minutes', 'kWh', 4],
    ]);
    // Read, validated, estimated, not validated.
    expect(series[0]!.values.map((v) => [v.at, v.value, v.quality])).toEqual([
      ['2026-06-09T22:00:00.000Z', 0.25, 0], ['2026-06-09T22:15:00.000Z', 0.5, 0], ['2026-06-09T22:30:00.000Z', 0.75, 1], ['2026-06-09T22:45:00.000Z', 1, 100],
    ]);
  });

  it('asks seven days at most per call, and gives one series over the whole period', async () => {
    expect(windows('2026-06-10', '2026-06-19')).toEqual([['2026-06-10', '2026-06-17'], ['2026-06-17', '2026-06-19']]);
    expect(windows('2026-06-10', '2026-06-17')).toEqual([['2026-06-10', '2026-06-17']]);
    expect(windows('2026-06-10', '2026-06-10')).toEqual([]);
    expect(() => windows('10/06/2026', '2026-06-17')).toThrow(/date_unreadable/);
    const api = fakeApi(routes());
    const series = await ores({ credentials, fetch: api.fetch })
      .readings({ identifier: EAN, scheme: 'gs1_gsrn', direction: 'offtake' }, '2026-06-10', '2026-06-19', { mandate, hub });
    expect(api.calls.map((c) => [new URL(c.url).searchParams.get('from'), new URL(c.url).searchParams.get('to')])).toEqual([
      ['2026-06-09T22:00:00Z', '2026-06-16T22:00:00Z'], ['2026-06-16T22:00:00Z', '2026-06-18T22:00:00Z'],
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]!.values.map((v) => v.at)).toEqual([
      '2026-06-09T22:00:00.000Z', '2026-06-09T22:15:00.000Z', '2026-06-09T22:30:00.000Z', '2026-06-09T22:45:00.000Z',
      '2026-06-16T22:00:00.000Z', '2026-06-16T22:15:00.000Z',
    ]);
  });

  it('reads a meter read remotely on its point, keeps the point of the meter, and refuses a state the hub\'s table does not hold', () => {
    const remote = json('energy-amr.json');
    // The reactive terms of the answer are left: the series are the active energy.
    expect(energySeries(remote, { identifier: REMOTE }, hub, 'ores').map((s) => [s.quantity_code, s.values.map((v) => [v.value, v.quality])])).toEqual([
      ['offtake_energy', [[12.892, 0], [11.5, 0]]],
      ['injection_energy', [[21.082, 0], [20, 1]]],
    ]);
    expect(() => energySeries(remote, { identifier: EAN }, hub, 'ores')).toThrow(/source_unavailable: ores answered for 541449000000000028, not 541449000000000011/);
    expect(() => energySeries(json('energy-digital.json'), { identifier: EAN }, { ...hub, quality_codes: { READ: 0 } }, 'ores')).toThrow(/quality_unknown: ores state "VAL"/);
    expect(energySeries({ data: { headpoint: [] } }, { identifier: EAN }, hub, 'ores')).toEqual([]);
    expect(energySeries(null, { identifier: EAN }, hub, 'ores')).toEqual([]);
  });
});

describe('the whole path on a database with the be pack', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDatabase(['grid'], ['be']);
  });
  afterAll(async () => {
    await db.close();
  });

  it('checks the mandate, reads through the operator with the conventions of its pack row, and keeps the series on the meter', async () => {
    const source = await one<{ auth: string; redistributable: boolean; regions: string[] }>(db,
      `select auth, redistributable, regions from sources where code = 'ores_service_provider_api'`);
    expect(source).toMatchObject({ auth: 'mandate', redistributable: false });
    // The region and its country are the ones the source row serves, as data.
    const region = source.regions[0]!;
    const country = region.split('-')[0]!;
    const org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A community', country });
    const site = (await one<{ id: string }>(db, `select join_project($1, 'Town hall', $2) id`, [project, { country, region }])).id;
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [site, EAN])).id;
    const connector = await insert(db, 'connectors', {
      organisation_id: org, source_code: 'ores_service_provider_api', name: 'ORES', secret_ref: 'ores_credentials', config: {},
    });
    const request = { connectorId: connector, meterId: meter, from: '2026-06-10', to: '2026-06-11', step: 'PT15M', on: '2026-06-11' };
    const client = ores({ credentials, fetch: fakeApi(routes()).fetch });
    await expect(collectMeterReadings(db as unknown as Db, client, request)).rejects.toThrow(/mandate_missing/);

    const id = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT15M', '{load_curve}', 'sharing_operation', '2026-06-01', null, '2025-01-01', null, 'ores') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true, null, 'REF-0001')`, [id]);
    const { stored } = await collectMeterReadings(db as unknown as Db, client, request);
    expect(stored.map((s) => [s.quantity_code, s.inserted])).toEqual([['offtake_energy', 4], ['injection_energy', 4]]);
    const values = await db.query(`select at, value, quality from series_values where series_id = $1 order by at`, [stored[0]!.seriesId]);
    expect(values.rows).toEqual([
      { at: new Date('2026-06-09T22:00:00Z'), value: 0.25, quality: 0 },
      { at: new Date('2026-06-09T22:15:00Z'), value: 0.5, quality: 0 },
      { at: new Date('2026-06-09T22:30:00Z'), value: 0.75, quality: 1 },
      { at: new Date('2026-06-09T22:45:00Z'), value: 1, quality: 100 },
    ]);
  });
});
