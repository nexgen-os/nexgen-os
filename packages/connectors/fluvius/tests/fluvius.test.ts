// @nexgen-os/fluvius, offline: the answers of the API are fixtures built
// after the shape the live API answers (`headpoint` → `physicalMeters` →
// `quarterHourlyEnergy`), with made-up EANs, references and values. Then the
// whole path on a database with the be pack: the mandate checked, the
// energy read with the hub's conventions, the series of the meter stored.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, createVerify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { collectMeterReadings, type Db, type MeterMandate } from '@nexgen-os/core';
import { clientAssertion, energySeries, fluvius, mandateStatusOf, type HttpFetch } from '../src/index.js';
import { freshDatabase, insert, one, organisation } from '../../../../tests/helpers/db.js';

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }

/** A fake operator: answers by method and path; records every call. */
function fakeApi(routes: Record<string, unknown>): { fetch: HttpFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HttpFetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    const key = `${method} ${url.replace(/\?.*$/, '')}`;
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}), text: async () => `no route ${key}` };
    const answer = routes[key];
    return { ok: true, status: 200, json: async () => answer, text: async () => JSON.stringify(answer) };
  };
  return { fetch, calls };
}

const TOKEN = 'POST https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token';
const SBX = 'https://apihub.fluvius.be/esco-sbx/v3/api';
const EAN = '541448000000000015';
const sandbox = { clientId: 'client-1', subscriptionKey: 'sub-1', clientSecret: 'secret-1' };
const config = { tenantId: 'tenant-1', scope: 'api://the-api/.default', environment: 'sandbox' as const };
const mandate: MeterMandate = {
  id: 'm-1', operator: 'fluvius', scope: ['load_curve'], granularity: 'PT15M', data_from: null, data_to: null, valid_to: null, external_reference: 'REF-0001',
};
const hub = { operator: 'fluvius', time_zone: 'Europe/Brussels', quality_codes: { READ: 0 }, sources: [], history_months: null, steps: ['PT15M'] };
const routes = () => ({
  [TOKEN]: { access_token: 'token-1', expires_in: 3600, token_type: 'Bearer' },
  [`GET ${SBX}/mandate`]: json('mandates.json'),
  [`GET ${SBX}/mandate/energy`]: json('energy.json'),
  [`POST ${SBX}/shortUrlIdentifier`]: json('short-url.json'),
});

describe('the API for service providers', () => {
  it('takes a token once with the sandbox secret, and calls with it and the subscription key', async () => {
    const api = fakeApi(routes());
    const client = fluvius({ credentials: sandbox, ...config, fetch: api.fetch });
    const mandates = await client.mandates();
    await client.mandates();
    expect(api.calls.filter((c) => c.url.includes('/token'))).toHaveLength(1);
    expect(new URLSearchParams(api.calls[0]!.body)).toEqual(new URLSearchParams({
      grant_type: 'client_credentials', client_id: 'client-1', scope: 'api://the-api/.default', client_secret: 'secret-1',
    }));
    expect(api.calls[1]!.headers).toMatchObject({ Authorization: 'Bearer token-1', 'Ocp-Apim-Subscription-Key': 'sub-1' });
    expect(mandates.map((m) => [m.referenceNumber, m.status, m.ean, mandateStatusOf(m.status)])).toEqual([
      ['REF-0001', 'Approved', EAN, 'approved'], ['REF-0002', 'Requested', '541448000000000022', null], ['REF-0003', 'Finished', null, 'expired'],
    ]);
    expect([mandateStatusOf('Rejected'), mandateStatusOf('Something new'), mandateStatusOf(null)]).toEqual(['refused', null, null]);
  });

  it('refuses to be built without its secrets or its tenant, and names an answer it is refused', async () => {
    expect(() => fluvius({ credentials: { clientId: '', subscriptionKey: 's' }, ...config })).toThrow(/secret_not_found/);
    expect(() => fluvius({ credentials: { clientId: 'c', subscriptionKey: 's' }, ...config })).toThrow(/secret_not_found: fluvius sandbox/);
    expect(() => fluvius({ credentials: sandbox, ...config, environment: 'live' })).toThrow(/secret_not_found: fluvius live/);
    expect(() => fluvius({ credentials: sandbox, ...config, tenantId: '' })).toThrow(/config_invalid/);
    const refused: HttpFetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'bad secret' });
    await expect(fluvius({ credentials: sandbox, ...config, fetch: refused }).mandates()).rejects.toThrow(/source_unauthorised: fluvius token 401/);
  });

  it('asks a consent link under the contract, dates to the second, and gives the operator\'s page', async () => {
    const api = fakeApi(routes());
    const request = { referenceNumber: 'REF-0004', flow: 'B2C' as const, dataPeriodFrom: '2025-01-01T00:00:00.000Z', dataPeriodTo: '2029-01-01T00:00:00.000Z' };
    await expect(fluvius({ credentials: sandbox, ...config, fetch: api.fetch }).consentLink(request)).rejects.toThrow(/contract_number_required/);
    const link = await fluvius({ credentials: sandbox, ...config, contractNumber: '0000000000', fetch: api.fetch }).consentLink(request);
    expect(link).toEqual({ id: 'a1b2c3', url: 'https://mijn.fluvius.be/verbruik/dienstverlener?id=a1b2c3', validTo: '2026-06-12T06:00:00Z' });
    expect(JSON.parse(api.calls.at(-1)!.body!)).toEqual({
      dataAccessContractNumber: '0000000000', referenceNumber: 'REF-0004', flow: 'B2C',
      dataServices: [{ dataServiceType: 'VH_kwartier_uur', dataPeriodFrom: '2025-01-01T00:00:00Z', dataPeriodTo: '2029-01-01T00:00:00Z' }],
    });
  });

  it.skipIf(!hasOpenssl())('signs the live client assertion with the certificate\'s key, its thumbprint in x5t', () => {
    const { certificate, privateKey } = selfSigned();
    const assertion = clientAssertion({ clientId: 'client-1', certificate, privateKey }, 'https://login.example/token', Date.UTC(2026, 5, 11));
    const [header, payload, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({ alg: 'RS256', typ: 'JWT', x5t: expect.stringMatching(/^[\w-]{27}$/) });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({
      aud: 'https://login.example/token', iss: 'client-1', sub: 'client-1', nbf: 1781136000, exp: 1781136600,
    });
    const verified = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(createPublicKey(certificate), Buffer.from(signature!, 'base64url'));
    expect(verified).toBe(true);
    expect(() => clientAssertion({ clientId: 'c', certificate: 'not a pem', privateKey }, 'a', 0)).toThrow(/certificate_unreadable/);
  });
});

describe('reading a meter', () => {
  it('refuses without the mandate the check returned, another step, or a hub without its zone', async () => {
    const client = fluvius({ credentials: sandbox, ...config, fetch: fakeApi(routes()).fetch });
    const meter = { identifier: EAN, scheme: 'gs1_gsrn' };
    await expect(client.readings(meter, '2026-06-10', '2026-06-11')).rejects.toThrow(/mandate_missing/);
    await expect(client.readings(meter, '2026-06-10', '2026-06-11', { mandate, hub, step: 'PT1H' })).rejects.toThrow(/step_unsupported/);
    await expect(client.readings(meter, '2026-06-10', '2026-06-11', { mandate, hub: { ...hub, time_zone: null } })).rejects.toThrow(/time_zone_required/);
    await expect(client.readings({ identifier: '5414', scheme: 'gs1_gsrn' }, '2026-06-10', '2026-06-11', { mandate, hub })).rejects.toThrow(/invalid_identifier/);
  });

  it('asks the hub\'s days by EAN and gives offtake and injection, each quarter hour at its start in UTC', async () => {
    const api = fakeApi(routes());
    const series = await fluvius({ credentials: sandbox, ...config, fetch: api.fetch })
      .readings({ identifier: EAN, scheme: 'gs1_gsrn', direction: 'both' }, '2026-06-10', '2026-06-11', { mandate, hub });
    const asked = new URL(api.calls.at(-1)!.url);
    expect(Object.fromEntries(asked.searchParams)).toEqual({ ean: EAN, periodType: 'readTime', from: '2026-06-09T22:00:00Z', to: '2026-06-10T22:00:00Z' });
    expect(series.map((s) => [s.quantity_code, s.value_kind, s.step, s.unit, s.values.length])).toEqual([
      ['offtake_energy', 'interval', '15 minutes', 'kWh', 4],
      ['injection_energy', 'interval', '15 minutes', 'kWh', 3],
    ]);
    // The last stamp carries no offset: it is read in the hub's zone.
    expect(series[0]!.values.map((v) => [v.at, v.value, v.quality])).toEqual([
      ['2026-06-09T22:00:00.000Z', 0.25, 0], ['2026-06-09T22:15:00.000Z', 0.5, 0], ['2026-06-09T22:30:00.000Z', 0.75, 0], ['2026-06-09T22:45:00.000Z', 1, 0],
    ]);
  });

  it('keeps the direction of the meter, and refuses a state the hub\'s table does not hold', () => {
    const answer = json('energy.json');
    expect(energySeries(answer, { identifier: EAN, direction: 'offtake' }, hub).map((s) => s.quantity_code)).toEqual(['offtake_energy']);
    expect(() => energySeries(answer, { identifier: EAN }, { ...hub, quality_codes: {} })).toThrow(/quality_unknown: fluvius state "READ"/);
    expect(() => energySeries(answer, { identifier: '541448000000000022' }, hub)).toThrow(/answered for 541448000000000015/);
    expect(energySeries({ data: {} }, { identifier: EAN }, hub)).toEqual([]);
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

  it('checks the mandate, reads through the operator, and keeps the series on the meter', async () => {
    expect(await one(db, `select auth, redistributable, regions from sources where code = 'fluvius_service_provider_api'`))
      .toEqual({ auth: 'mandate', redistributable: false, regions: ['BE-VLG'] });
    const org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'A study', country: 'BE' });
    const site = (await one<{ id: string }>(db, `select join_project($1, 'Warehouse', $2) id`, [project, { country: 'BE', region: 'BE-VLG' }])).id;
    const meter = (await one<{ id: string }>(db, `select declare_meter($1, $2, 'gs1_gsrn') id`, [site, EAN])).id;
    const connector = await insert(db, 'connectors', {
      organisation_id: org, source_code: 'fluvius_service_provider_api', name: 'Fluvius', secret_ref: 'fluvius_credentials', config: { environment: 'sandbox' },
    });
    const request = { connectorId: connector, meterId: meter, from: '2026-06-10', to: '2026-06-11', step: 'PT15M', on: '2026-06-11' };
    const client = fluvius({ credentials: sandbox, ...config, fetch: fakeApi(routes()).fetch });
    await expect(collectMeterReadings(db as unknown as Db, client, request)).rejects.toThrow(/mandate_missing/);

    const id = (await one<{ id: string }>(db,
      `select grid.request_mandate($1, 'PT15M', '{load_curve}', 'study', '2026-06-01', null, '2025-01-01', null, 'fluvius') id`, [meter])).id;
    await db.query(`select grid.decide_mandate($1, true, null, 'REF-0001')`, [id]);
    const { stored } = await collectMeterReadings(db as unknown as Db, client, request);
    expect(stored.map((s) => [s.quantity_code, s.inserted])).toEqual([['offtake_energy', 4], ['injection_energy', 3]]);
    const values = await db.query(`select at, value, quality from series_values where series_id = $1 order by at limit 2`, [stored[0]!.seriesId]);
    expect(values.rows).toEqual([
      { at: new Date('2026-06-09T22:00:00Z'), value: 0.25, quality: 0 },
      { at: new Date('2026-06-09T22:15:00Z'), value: 0.5, quality: 0 },
    ]);
  });
});

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A throwaway self-signed certificate and its key, made for the test and never kept. */
function selfSigned(): { certificate: string; privateKey: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fluvius-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  return { certificate: readFileSync(join(dir, 'cert.pem'), 'utf8'), privateKey: readFileSync(join(dir, 'key.pem'), 'utf8') };
}
