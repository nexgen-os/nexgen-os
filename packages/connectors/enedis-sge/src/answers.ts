// Reading the SOAP answers of the gateway. The web services date a step at
// its END, with an offset (`d = 00:30+01:00` closes the first half hour of a
// day): that is the web services' convention, kept here and never mixed with
// the R63 file's, which dates the start in legal time without an offset
// (`@nexgen-os/enedis-r6x`). Every point comes back at the start of its step
// in UTC.

import { childText, durationMs, findAll, findFirst, parseXml, type XmlNode } from '@nexgen-os/enedis-r6x';

/** A refusal of the gateway, by its own code when it gives one (`SGT4L8`), else by HTTP status. */
export class SgeRefusal extends Error {
  constructor(readonly code: string, detail: string) {
    super(`source_refused: enedis_sge ${code}: ${detail}`);
  }
}

/** The SOAP body of an answer; a fault, an HTTP error or a result code other than SGT200 refused by name. */
export function soapBody(status: number, xml: string): XmlNode {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new SgeRefusal(`HTTP_${status}`, `unreadable answer (${(error as Error).message})`);
  }
  const body = findFirst(root, 'Body');
  if (!body) throw new SgeRefusal(`HTTP_${status}`, 'an answer without a SOAP body');
  const fault = findFirst(body, 'Fault');
  if (fault) {
    const result = findFirst(fault, 'resultat');
    throw new SgeRefusal(result?.attributes.code || childText(fault, 'faultcode') || `HTTP_${status}`,
      result?.text.trim() || childText(fault, 'faultstring') || 'SOAP fault');
  }
  if (status < 200 || status >= 300) throw new SgeRefusal(`HTTP_${status}`, 'an HTTP error without a SOAP fault');
  const ack = findFirst(body, 'resultat');
  if (ack?.attributes.code && ack.attributes.code !== 'SGT200') throw new SgeRefusal(ack.attributes.code, ack.text.trim() || 'refused');
  return body;
}

export interface MeasurePoint {
  /** The start of the step in UTC, ISO 8601. */
  start: string;
  /** NaN when the gateway gives no value. */
  value: number;
  /** The nature letter (`n`), mapped by the hub's table of the pack. */
  nature: string | null;
  /** The step (`p`), an ISO 8601 duration. */
  step: string | null;
}

export interface MeasureSeries {
  pointId: string | null;
  business: string | null;
  physical: string | null;
  unit: string | null;
  points: MeasurePoint[];
}

/**
 * The series of a `ConsultationMesuresDetaillees` answer. Its points are the
 * `<mesure>` elements of the v2.0 samples (`<points>` read too, for the next
 * version), each `d` the END of its step with an offset: the start is `d`
 * minus `p`. A stamp without an offset is refused (`date_offset_required`):
 * that would be the file convention, not the web services'.
 */
export function detailedMeasures(status: number, xml: string): MeasureSeries[] {
  const body = soapBody(status, xml);
  const pointId = findFirst(body, 'pointId')?.text.trim() || null;
  return findAll(body, 'grandeur').map((g) => ({
    pointId,
    business: childText(g, 'grandeurMetier'),
    physical: childText(g, 'grandeurPhysique'),
    unit: childText(g, 'unite'),
    points: [...findAll(g, 'mesure'), ...findAll(g, 'points')].map((p) => {
      const end = childText(p, 'd');
      if (!end) throw new SgeRefusal('INVALID_ANSWER', 'a measure without a date');
      const step = childText(p, 'p');
      const raw = childText(p, 'v');
      return { start: new Date(endToStart(end, step)).toISOString(), value: raw === null ? Number.NaN : Number(raw), nature: childText(p, 'n'), step };
    }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  }));
}

function endToStart(end: string, step: string | null): number {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(end.trim())) {
    throw new SgeRefusal('date_offset_required', `${end}: a web service answer dates the end of a step with its offset`);
  }
  const at = Date.parse(end.trim().replace(' ', 'T'));
  const ms = step ? durationMs(step) : 0;
  if (Number.isNaN(at) || ms === null) throw new SgeRefusal('INVALID_ANSWER', `${end} ${step ?? ''}`);
  return at - ms;
}

export interface FoundPoint {
  pointId: string;
  holder: string | null;
  addressLines: string[];
  state: string | null;
}

/** The points of a `RecherchePoint` answer. */
export function foundPoints(status: number, xml: string): FoundPoint[] {
  const body = soapBody(status, xml);
  return findAll(body, 'point').filter((p) => p.attributes.id).map((p) => {
    const address = findFirst(p, 'adresseInstallationNormalisee');
    return {
      pointId: p.attributes.id!,
      holder: childText(p, 'nomClientFinalOuDenominationSociale'),
      addressLines: address ? address.children.map((c) => c.text.trim()).filter(Boolean) : [],
      state: childText(p, 'etatContractuelCode'),
    };
  });
}

export interface TechnicalData {
  pointId: string | null;
  segment: string | null;
  state: string | null;
  subscribedPower: { value: number; unit: string } | null;
  gridTariff: string | null;
}

/** What a `ConsultationDonneesTechniquesContractuelles` answer says of a point. */
export function technicalData(status: number, xml: string): TechnicalData {
  const body = soapBody(status, xml);
  const power = findFirst(body, 'puissanceSouscriteMax');
  const value = power ? Number(childText(power, 'valeur')) : Number.NaN;
  return {
    pointId: findFirst(body, 'point')?.attributes.id ?? null,
    segment: findFirst(body, 'segment')?.attributes.code ?? null,
    state: findFirst(body, 'etatContractuel')?.attributes.code ?? null,
    subscribedPower: power && !Number.isNaN(value) ? { value, unit: childText(power, 'unite') ?? '' } : null,
    gridTariff: findFirst(body, 'formuleTarifaireAcheminement')?.attributes.code ?? null,
  };
}

/** The case number of a `CommandeCollectePublicationMesures` answer. */
export function collectionCase(status: number, xml: string): string {
  const body = soapBody(status, xml);
  const id = findFirst(body, 'affaireId')?.text.trim();
  if (!id) throw new SgeRefusal('INVALID_ANSWER', 'a collection order without its case number');
  return id;
}
