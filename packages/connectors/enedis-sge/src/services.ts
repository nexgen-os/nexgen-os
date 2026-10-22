// The web services of the operator's third-party gateway (SGE) this
// connector speaks, and the SOAP requests it sends. Names, paths and
// namespaces follow the public homologation samples of consometers/sge-tiers
// (https://github.com/consometers/sge-tiers, EUPL-1.2, cited, not copied);
// what only the contract and the homologation pin down — the production
// endpoints, the versions in force, the order of elements — is confirmed
// there, in this file only.

import { escapeXml } from '@nexgen-os/enedis-r6x';

export interface SgeService {
  /** The service in the operator's catalogue. */
  name: string;
  /** Its path under the base URL, `/<Service>/v<version>`. */
  path: string;
  /** The namespace of its operation element. */
  namespace: string;
  /** The operation element, also its SOAPAction. */
  operation: string;
}

export const SGE_SERVICES = {
  /** A point found by its address and its holder, outside the third party's own perimeter. */
  searchPoint: {
    name: 'RecherchePoint',
    path: '/RecherchePoint/v2.0',
    namespace: 'http://www.enedis.fr/sge/b2b/services/rechercherpoint/v2.0',
    operation: 'rechercherPoint',
  },
  /** Technical and contractual data of a point: segment, subscribed power, tariff, state. */
  technicalData: {
    name: 'ConsultationDonneesTechniquesContractuelles',
    path: '/ConsultationDonneesTechniquesContractuelles/v1.0',
    namespace: 'http://www.enedis.fr/sge/b2b/services/consultationdonneestechniquescontractuelles/v1.0',
    operation: 'consulterDonneesTechniquesContractuelles',
  },
  /** Detailed measures over a few days: load curve (PA, PRI, PRC), energy, maximum power. */
  detailedMeasures: {
    name: 'ConsultationMesuresDetaillees',
    path: '/ConsultationMesuresDetaillees/v2.0',
    namespace: 'http://www.enedis.fr/sge/b2b/services/consultationmesuresdetaillees/v2.0',
    operation: 'consulterMesuresDetaillees',
  },
  /** The collection of a load curve turned on, and its recurring publication subscribed. */
  collectionOrder: {
    name: 'CommandeCollectePublicationMesures',
    path: '/CommandeCollectePublicationMesures/v3.0',
    namespace: 'http://www.enedis.fr/sge/b2b/commandecollectepublicationmesures/v3.0',
    operation: 'commanderCollectePublicationMesures',
  },
} as const satisfies Record<string, SgeService>;

export const SOAP_ENVELOPE_NS = 'http://schemas.xmlsoap.org/soap/envelope/';

/** A value of an element tree: nested objects are nested elements, arrays repeat, null is left out. */
export type XmlValue = string | number | boolean | null | undefined | { [element: string]: XmlValue } | XmlValue[];

/** The elements of an object, in its key order, every text escaped. */
export function toXml(value: { [element: string]: XmlValue }): string {
  return Object.entries(value).map(([name, v]) => element(name, v)).join('');
}

function element(name: string, value: XmlValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => element(name, v)).join('');
  if (typeof value === 'object') return `<${name}>${toXml(value)}</${name}>`;
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** A SOAP 1.1 envelope around the operation of a service. */
export function soapEnvelope(service: SgeService, payload: { [element: string]: XmlValue }): string {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<soapenv:Envelope xmlns:soapenv="${SOAP_ENVELOPE_NS}" xmlns:sge="${service.namespace}">`
    + '<soapenv:Header/>'
    + `<soapenv:Body><sge:${service.operation}>${toXml(payload)}</sge:${service.operation}></soapenv:Body>`
    + '</soapenv:Envelope>';
}

export type SgeDirection = 'SOUTIRAGE' | 'INJECTION';

export interface DetailedMeasuresQuery {
  pointId: string;
  /** `COURBE` a load curve, `ENERGIE` energy per day, `PMAX` maximum power per day. */
  measureType: 'COURBE' | 'ENERGIE' | 'PMAX';
  /** `PA` active power, `PRI` / `PRC` reactive power, `EA` active energy, `PMA` maximum power. */
  physicalQuantity: 'PA' | 'PRI' | 'PRC' | 'EA' | 'PMA';
  /** `YYYY-MM-DD`, the first day; `to` the day after the last. */
  from: string;
  to: string;
  direction: SgeDirection;
  corrected?: boolean;
}

/** The request of detailed measures, declaring the customer's agreement (`accordClient`). */
export function detailedMeasuresRequest(login: string, q: DetailedMeasuresQuery): string {
  return soapEnvelope(SGE_SERVICES.detailedMeasures, {
    demande: {
      initiateurLogin: login,
      pointId: q.pointId,
      mesuresTypeCode: q.measureType,
      grandeurPhysique: q.physicalQuantity,
      soutirage: q.direction === 'SOUTIRAGE',
      injection: q.direction === 'INJECTION',
      dateDebut: q.from,
      dateFin: q.to,
      mesuresCorrigees: q.corrected ?? false,
      accordClient: true,
    },
  });
}

export function technicalDataRequest(login: string, pointId: string): string {
  return soapEnvelope(SGE_SERVICES.technicalData, { pointId, loginUtilisateur: login, autorisationClient: true });
}

export interface PointSearch {
  holderName: string;
  street?: string;
  postalCode?: string;
  /** The municipality in the country's own code. */
  municipalityCode?: string;
}

export function searchPointRequest(login: string, c: PointSearch): string {
  const address = c.street || c.postalCode || c.municipalityCode
    ? { numeroEtNomVoie: c.street, codePostal: c.postalCode, codeInseeCommune: c.municipalityCode }
    : undefined;
  return soapEnvelope(SGE_SERVICES.searchPoint, {
    criteres: { adresseInstallation: address, nomClientFinalOuDenominationSociale: c.holderName, rechercheHorsPerimetre: true },
    loginUtilisateur: login,
  });
}

/** Who gave the agreement, as declared to the operator: a company by its name, a person by their last name. */
export type Holder = { kind: 'company'; name: string } | { kind: 'person'; lastName: string; title?: string };

export interface CollectionOrder {
  pointId: string;
  /** The third party's contract with the operator (`connectors.config.contract_id`; not a secret). */
  contractId: string;
  from: string;
  /** The end of the customer's agreement. */
  to: string;
  holder: Holder;
  direction: SgeDirection;
}

export function collectionOrderRequest(login: string, o: CollectionOrder): string {
  const holder = o.holder.kind === 'company'
    ? { personneMorale: { denominationSociale: o.holder.name } }
    : { personnePhysique: { civilite: o.holder.title, nom: o.holder.lastName } };
  return soapEnvelope(SGE_SERVICES.collectionOrder, {
    demande: {
      donneesGenerales: { objetCode: 'AME', pointId: o.pointId, initiateurLogin: login, contratId: o.contractId },
      accesMesures: {
        dateDebut: o.from,
        dateFin: o.to,
        declarationAccordClient: { accord: true, ...holder },
        mesuresTypeCode: 'CDC',
        soutirage: o.direction === 'SOUTIRAGE',
        injection: o.direction === 'INJECTION',
        mesuresCorrigees: false,
        transmissionRecurrente: true,
        periodiciteTransmission: 'P1D',
      },
    },
  });
}
