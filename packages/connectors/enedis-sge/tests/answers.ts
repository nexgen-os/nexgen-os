// Answers of the gateway, built after the public homologation samples of
// consometers/sge-tiers (https://github.com/consometers/sge-tiers,
// EUPL-1.2): their shape — the v2.0 namespace, `<mesure>` elements, `d` the
// end of a step with its offset — not their content. The points, names and
// values are invented. Recorded answers of the homologation replace them;
// the readers must pass them unchanged.

const envelope = (body: string) => '<?xml version="1.0" encoding="UTF-8"?>'
  + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' + body + '</soap:Body></soap:Envelope>';

const mesure = (v: string, d: string, n = 'R') => `<mesure><v>${v}</v><d>${d}</d><p>PT30M</p><n>${n}</n></mesure>`;

/** The first two hours of a winter day: the first half hour closes at 00:30+01:00; 01:30 is missing; the last one estimated. */
export const DETAILED_MEASURES = envelope(
  '<ns2:consulterMesuresDetailleesResponse xmlns:ns2="http://www.enedis.fr/sge/b2b/services/consultationmesuresdetaillees/v2.0">'
  + '<grandeur><grandeurMetier>CONS</grandeurMetier><grandeurPhysique>PA</grandeurPhysique><unite>W</unite>'
  + mesure('1200', '2026-01-15T00:30:00+01:00') + mesure('800', '2026-01-15T01:00:00+01:00')
  + mesure('400', '2026-01-15T02:00:00+01:00', 'E')
  + '</grandeur><pointId>00000000000003</pointId>'
  + '</ns2:consulterMesuresDetailleesResponse>');

/** The same, dated without an offset: the file convention, refused in a web service answer. */
export const DETAILED_MEASURES_WITHOUT_OFFSET = DETAILED_MEASURES.replace(/\+01:00/g, '');

export const FAULT_HISTORY = envelope(
  '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Functional error</faultstring>'
  + '<detail><erreur xmlns="http://www.enedis.fr/sge/b2b/technique/v1.0"><resultat code="SGT4L8">The period asked is beyond the history allowed.</resultat></erreur></detail>'
  + '</soap:Fault>');

export const POINT_SEARCH = envelope(
  '<ns2:rechercherPointResponse xmlns:ns2="http://www.enedis.fr/sge/b2b/services/rechercherpoint/v2.0"><points>'
  + '<point id="00000000000003"><adresseInstallationNormalisee><ligne1>EXAMPLE WAREHOUSE</ligne1><ligne4>1 EXAMPLE STREET</ligne4><ligne6>00000 EXAMPLE TOWN</ligne6></adresseInstallationNormalisee>'
  + '<etatContractuelCode>SERVC</etatContractuelCode><nomClientFinalOuDenominationSociale>EXAMPLE COMPANY</nomClientFinalOuDenominationSociale></point>'
  + '</points></ns2:rechercherPointResponse>');

export const TECHNICAL_DATA = envelope(
  '<ns2:consulterDonneesTechniquesContractuellesResponse xmlns:ns2="x"><point id="00000000000003">'
  + '<donneesGenerales><etatContractuel code="SERVC">In service</etatContractuel><segment code="C4">C4</segment></donneesGenerales>'
  + '<situationContractuelle><structureTarifaire><puissanceSouscriteMax><valeur>120</valeur><unite>kVA</unite></puissanceSouscriteMax>'
  + '<formuleTarifaireAcheminement code="BTSUPCU"><libelle>Low voltage above 36 kVA</libelle></formuleTarifaireAcheminement></structureTarifaire></situationContractuelle>'
  + '</point></ns2:consulterDonneesTechniquesContractuellesResponse>');

export const COLLECTION_ACK = envelope(
  '<ns2:commanderCollectePublicationMesuresResponse xmlns:ns2="x"><affaireId>A00000001</affaireId></ns2:commanderCollectePublicationMesuresResponse>');
