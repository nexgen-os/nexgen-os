// @nexgen-os/enedis-sge, offline on an injected transport: the requests it
// sends, the answers it reads (the end of a step with its offset, distinct
// from the R63 file's start in legal time), and its refusals.
import { describe, expect, it } from 'vitest';
import type { MeterMandate } from '@nexgen-os/core';
import { enedisSge, SGE_HOMOLOGATION_URL, type SoapCall, type SoapTransport } from '../src/index.js';
import { COLLECTION_ACK, DETAILED_MEASURES, DETAILED_MEASURES_WITHOUT_OFFSET, FAULT_HISTORY, POINT_SEARCH, TECHNICAL_DATA } from './answers.js';

function recorder(answers: Record<string, { status: number; body: string }>): { transport: SoapTransport; calls: SoapCall[] } {
  const calls: SoapCall[] = [];
  return {
    calls,
    transport: async (call) => {
      calls.push(call);
      return answers[call.soapAction] ?? { status: 500, body: '' };
    },
  };
}

const mandate: MeterMandate = {
  id: 'm-1', operator: 'enedis', scope: ['load_curve', 'technical_data'], granularity: 'PT30M', data_from: null, data_to: null, valid_to: null, external_reference: null,
};
// The hub's table as the fr pack gives it: data of the test.
const hub = { operator: 'enedis', time_zone: 'Europe/Paris', quality_codes: { R: 0, E: 1, missing: 3 }, sources: [], history_months: 24, steps: [] };
const meter = { identifier: '00000000000003', scheme: 'prm', direction: 'offtake' as const };

describe('the gateway', () => {
  it('reads a load curve dated at the end of each step with its offset, as steps at their start in UTC', async () => {
    const r = recorder({ consulterMesuresDetaillees: { status: 200, body: DETAILED_MEASURES } });
    const sge = enedisSge({ baseUrl: SGE_HOMOLOGATION_URL, login: 'tiers@example.org', transport: r.transport });
    const [series] = await sge.readings(meter, '2026-01-15', '2026-01-16', { mandate, hub });
    expect(series).toMatchObject({ quantity_code: 'offtake_power', value_kind: 'interval', step: '30 minutes', unit: 'W' });
    expect(series!.values.map((v) => [v.at, Number.isNaN(v.value) ? 'NaN' : v.value, v.quality])).toEqual([
      ['2026-01-14T23:00:00.000Z', 1200, 0], ['2026-01-14T23:30:00.000Z', 800, 0], ['2026-01-15T00:00:00.000Z', 'NaN', 3], ['2026-01-15T00:30:00.000Z', 400, 1],
    ]);
    expect(r.calls[0]!.url).toBe('https://sge-homologation-b2b.enedis.fr/ConsultationMesuresDetaillees/v2.0');
    expect(r.calls[0]!.body).toContain('<initiateurLogin>tiers@example.org</initiateurLogin><pointId>00000000000003</pointId><mesuresTypeCode>COURBE</mesuresTypeCode><grandeurPhysique>PA</grandeurPhysique><soutirage>true</soutirage><injection>false</injection><dateDebut>2026-01-15</dateDebut><dateFin>2026-01-16</dateFin>');
    expect(r.calls[0]!.body).toContain('<accordClient>true</accordClient>');
  });

  it('asks a long period in windows of seven days', async () => {
    const r = recorder({ consulterMesuresDetaillees: { status: 200, body: DETAILED_MEASURES } });
    await enedisSge({ baseUrl: SGE_HOMOLOGATION_URL, login: 'l', transport: r.transport }).readings(meter, '2026-01-01', '2026-01-20', { mandate, hub });
    expect(r.calls.map((c) => /<dateDebut>(.*)<\/dateDebut><dateFin>(.*)<\/dateFin>/.exec(c.body)!.slice(1))).toEqual([
      ['2026-01-01', '2026-01-08'], ['2026-01-08', '2026-01-15'], ['2026-01-15', '2026-01-20'],
    ]);
  });

  it('refuses without a mandate, a stamp without an offset, and a fault by its own code', async () => {
    const sge = (body: string) => enedisSge({ baseUrl: SGE_HOMOLOGATION_URL, login: 'l', transport: recorder({ consulterMesuresDetaillees: { status: 200, body } }).transport });
    await expect(sge(DETAILED_MEASURES).readings(meter, '2026-01-15', '2026-01-16')).rejects.toThrow(/mandate_missing/);
    await expect(sge(DETAILED_MEASURES).readings(meter, '2026-01-15', '2026-01-16', { mandate: { ...mandate, scope: ['daily_index'] }, hub })).rejects.toThrow(/mandate_scope/);
    await expect(sge(DETAILED_MEASURES_WITHOUT_OFFSET).readings(meter, '2026-01-15', '2026-01-16', { mandate, hub })).rejects.toThrow(/date_offset_required/);
    const fault = enedisSge({ baseUrl: SGE_HOMOLOGATION_URL, login: 'l', transport: recorder({ consulterMesuresDetaillees: { status: 500, body: FAULT_HISTORY } }).transport });
    await expect(fault.readings(meter, '2026-01-15', '2026-01-16', { mandate, hub })).rejects.toThrow(/source_refused: enedis_sge SGT4L8: The period asked/);
    expect(() => enedisSge({ baseUrl: '', login: 'l', transport: async () => ({ status: 200, body: '' }) })).toThrow(/connector_config_required/);
  });

  it('finds a point, reads its technical data under mandate, and orders a collection naming the holder', async () => {
    const r = recorder({
      rechercherPoint: { status: 200, body: POINT_SEARCH },
      consulterDonneesTechniquesContractuelles: { status: 200, body: TECHNICAL_DATA },
      commanderCollectePublicationMesures: { status: 200, body: COLLECTION_ACK },
    });
    const sge = enedisSge({ baseUrl: SGE_HOMOLOGATION_URL, login: 'l', transport: r.transport });
    expect(await sge.searchPoint({ holderName: 'EXAMPLE COMPANY', postalCode: '00000' })).toEqual([{
      pointId: '00000000000003', holder: 'EXAMPLE COMPANY', addressLines: ['EXAMPLE WAREHOUSE', '1 EXAMPLE STREET', '00000 EXAMPLE TOWN'], state: 'SERVC',
    }]);
    expect(r.calls[0]!.url).toBe('https://sge-homologation-b2b.enedis.fr/RecherchePoint/v2.0');
    await expect(sge.technicalData('00000000000003', null)).rejects.toThrow(/mandate_missing/);
    expect(await sge.technicalData('00000000000003', mandate)).toEqual({
      pointId: '00000000000003', segment: 'C4', state: 'SERVC', subscribedPower: { value: 120, unit: 'kVA' }, gridTariff: 'BTSUPCU',
    });
    const order = { pointId: '00000000000003', contractId: 'C-0001', from: '2026-01-15', to: '2027-01-15', direction: 'SOUTIRAGE' as const };
    await expect(sge.orderCollection({ ...order, holder: { kind: 'company', name: ' ' } }, mandate)).rejects.toThrow(/mandate_holder_required/);
    expect(await sge.orderCollection({ ...order, holder: { kind: 'company', name: 'EXAMPLE COMPANY' } }, mandate)).toBe('A00000001');
    expect(r.calls.at(-1)!.url).toBe('https://sge-homologation-b2b.enedis.fr/CommandeCollectePublicationMesures/v3.0');
    expect(r.calls.at(-1)!.body).toContain('<declarationAccordClient><accord>true</accord><personneMorale><denominationSociale>EXAMPLE COMPANY</denominationSociale></personneMorale></declarationAccordClient>');
  });
});
