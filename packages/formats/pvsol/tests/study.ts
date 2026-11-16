// A small PV*SOL study written in memory, in the shape of the .pvprj files
// PV*SOL premium 2025 and 2026 save: a ZIP archive with Windows separators,
// Project.xml, DB.json, OecForeCast.json, SimResults.xml and a weather file.
// A real study holds a customer's data and a licensed weather file: none is
// kept in this repository.
import { deflateRawSync, gzipSync } from 'node:zlib';

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const J = 3_600_000;

/** A ZIP archive of these files, deflated, or stored when asked. */
export function zip(files: Array<{ name: string; data: string | Uint8Array; stored?: boolean }>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : Buffer.from(file.data);
    const name = Buffer.from(file.name, 'utf8');
    const payload = file.stored ? data : deflateRawSync(data);
    const method = file.stored ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, payload);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(payload.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + payload.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

/** A year at 15 minutes: 2 kW in the first hour, 1 kW after it — 8 761 kWh. */
export function loadProfile(): { base64: string; count: number } {
  const count = 365 * 24 * 4;
  const watts = new Float64Array(count).map((_, i) => (i < 4 ? 2000 : 1000));
  // .NET writes the whole buffer: zeros follow the gzip member.
  return { base64: Buffer.concat([gzipSync(Buffer.from(watts.buffer)), Buffer.alloc(4096)]).toString('base64'), count };
}

const months = (value: number) => Array.from({ length: 12 }, () => `<MonthlyValues><value>${value}</value></MonthlyValues>`).join('');
const yearly = (value: number) => `<YearlyValue>${value}</YearlyValue>`;

export function projectXml(options: { program?: string; declaredTotal?: number } = {}): string {
  const profile = loadProfile();
  return `<?xml version="1.0" encoding="utf-8"?>
<PVData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Versionsnummer xsi:type="xsd:double">23</Versionsnummer>
  <Applikation>ValentinSoftware.PV.PVSOL.premium</Applikation>
  <ProgramsUsedToEditProject><Program>${options.program ?? 'PV*SOL premium 2026 (R1)'}</Program></ProgramsUsedToEditProject>
  <ProjektdatenV1>
    <Projekttitel><Value>Warehouse roof</Value></Projekttitel>
    <Bearbeiterin><Value>A. Designer</Value></Bearbeiterin>
    <InbetriebnahmeDatum><Value>04/16/2026 00:00:00</Value></InbetriebnahmeDatum>
    <AnlagenStandort><Anschrift><Value>1 Example Street
1000 Sample Town</Value></Anschrift></AnlagenStandort>
    <KundenAdresse><CustomerDetails><Unternehmen><Value>Example Logistics</Value></Unternehmen><Ansprechpartner><Value>B. Owner</Value></Ansprechpartner></CustomerDetails></KundenAdresse>
  </ProjektdatenV1>
  <PVModule>
    <Modulfelder>
      <ModulfeldID>area-ne</ModulfeldID>
      <Modulname>Building 01-Roof surface north-east</Modulname>
      <Modulneigung><Value>15</Value></Modulneigung>
      <Modulausrichtung><Value>52</Value></Modulausrichtung>
      <Modulanzahl><Value>135</Value></Modulanzahl>
      <ModulID>module-1</ModulID>
      <ModulHersteller>Example Solar</ModulHersteller>
      <ModulName>EX-450M</ModulName>
      <Bifaciality><BacksideIrradianceModel><Value>None</Value></BacksideIrradianceModel></Bifaciality>
    </Modulfelder>
    <Modulfelder>
      <ModulfeldID>area-sw</ModulfeldID>
      <Modulname>Building 01-Roof surface south-west</Modulname>
      <Modulneigung><Value>15</Value></Modulneigung>
      <Modulausrichtung><Value>231,5</Value></Modulausrichtung>
      <Modulanzahl><Value>162</Value></Modulanzahl>
      <ModulID>module-1</ModulID>
      <ModulHersteller>Example Solar</ModulHersteller>
      <ModulName>EX-450M</ModulName>
    </Modulfelder>
    <Modulfelder>
      <ModulfeldID>area-empty</ModulfeldID>
      <Modulname>Canopy</Modulname>
      <Modulanzahl><Value>0</Value></Modulanzahl>
    </Modulfelder>
  </PVModule>
  <Meteo><VerlusteDurchSpektrumsAbweichung><Value>0.01</Value></VerlusteDurchSpektrumsAbweichung></Meteo>
  <PVModule2><VerlusteSimulation><AlbedoJahreswert><Value>0.2</Value></AlbedoJahreswert><VerschmutzungJahreswert><Value>0</Value></VerschmutzungJahreswert><VerlusteInDioden><Value>0.005</Value></VerlusteInDioden><MismatchHersteller><Value>0.02</Value></MismatchHersteller></VerlusteSimulation></PVModule2>
  <ACNetz><Gesamtverlust><Value>0.03</Value></Gesamtverlust></ACNetz>
  <Wechselrichter>
    <Verschaltung>
      <WRObj><InverterHersteller>Example Power</InverterHersteller><InverterName>EP 60</InverterName><Haeufigkeit>1</Haeufigkeit></WRObj>
      <WRObj><InverterHersteller>Example Power</InverterHersteller><InverterName>EP 60</InverterName><Haeufigkeit>1</Haeufigkeit></WRObj>
    </Verschaltung>
  </Wechselrichter>
  <Verbrauch>
    <VerbrauchGruppen>
      <Verbrauchsdefinition>
        <ImportierteProfile>
          <TotalConsumption xsi:type="xsd:double">${options.declaredTotal ?? 8761}</TotalConsumption>
          <NoOfValues xsi:type="xsd:int">${profile.count}</NoOfValues>
          <Name xsi:type="xsd:string">Site load 2025</Name>
          <Intervall xsi:type="xsd:int">15</Intervall>
          <Values xsi:type="xsd:base64Binary">${profile.base64}</Values>
        </ImportierteProfile>
      </Verbrauchsdefinition>
    </VerbrauchGruppen>
  </Verbrauch>
</PVData>`;
}

export const SIM_RESULTS = `<?xml version="1.0" encoding="utf-8"?>
<SimResultsXML>
  <MeteoResults>
    <EinstrahlungHor>${months(100 * J)}${yearly(1200 * J)}</EinstrahlungHor>
    <Aussentemperatur>${months(284.15)}${yearly(284.15)}</Aussentemperatur>
  </MeteoResults>
  <PVModuleResult><EinstrahlungGeneigt>${months(90 * J)}${yearly(1080 * J)}</EinstrahlungGeneigt></PVModuleResult>
  <PVModuleResult><EinstrahlungGeneigt>${months(100 * J)}${yearly(1200 * J)}</EinstrahlungGeneigt></PVModuleResult>
  <VerbrauchResults>
    <Verbrauch>${yearly(8761 * J)}</Verbrauch>
    <Eigenverbrauch>${yearly(5000 * J)}</Eigenverbrauch>
    <Netzbezug>${yearly(3761 * J)}</Netzbezug>
    <Netzeinspeisung>${yearly(120000 * J)}</Netzeinspeisung>
    <Eigenverbrauchsanteil>${yearly(0.04)}</Eigenverbrauchsanteil>
    <Solaredeckungsrate>${yearly(0.5707)}</Solaredeckungsrate>
  </VerbrauchResults>
  <EnergiebilanzResultsWr><EB_WR0_EingangsEnergie>${yearly(130000 * J)}</EB_WR0_EingangsEnergie><EB_WR5_PVEnergieAC>${yearly(125000 * J)}</EB_WR5_PVEnergieAC></EnergiebilanzResultsWr>
  <EnergiebilanzResultsWr><EB_WR0_EingangsEnergie>${yearly(62000 * J)}</EB_WR0_EingangsEnergie><EB_WR5_PVEnergieAC>${yearly(60000 * J)}</EB_WR5_PVEnergieAC></EnergiebilanzResultsWr>
  <EnergiebilanzResultsWr><EB_WR5_PVEnergieAC>${yearly(65000 * J)}</EB_WR5_PVEnergieAC></EnergiebilanzResultsWr>
  <ModulflaechenResults>
    <Guid_Area>area-ne</Guid_Area>
    <PerformanceRatio>${yearly(0.91)}</PerformanceRatio>
    <PVEnergyAC>${yearly(56000)}</PVEnergyAC>
    <SpecificAnnualEnergyYield>${yearly(922)}</SpecificAnnualEnergyYield>
  </ModulflaechenResults>
  <ModulflaechenResults>
    <Guid_Area>area-sw</Guid_Area>
    <PerformanceRatio>${yearly(0.92)}</PerformanceRatio>
    <PVEnergyAC>${yearly(69000)}</PVEnergyAC>
    <SpecificAnnualEnergyYield>${yearly(1081)}</SpecificAnnualEnergyYield>
  </ModulflaechenResults>
</SimResultsXML>`;

export const PRODUCTS = JSON.stringify({ PVModules: [{ Id: 'module-1', Name: 'EX-450M', SpecifiedOutputPower: 450 }] });
export const ECONOMICS = JSON.stringify({ PVLeistung: 133.65 });

/** The whole study, or the study without the files named. */
export function study(options: { without?: string[]; program?: string; declaredTotal?: number } = {}): Uint8Array {
  const files = [
    { name: 'Project.xml', data: projectXml(options) },
    { name: 'DB.json', data: '﻿' + PRODUCTS },
    { name: 'OecForeCast.json', data: ECONOMICS },
    { name: 'Results\\SimResults.xml', data: SIM_RESULTS },
    { name: 'Weather\\Sample Town.wbv', data: new Uint8Array([1, 2, 3]), stored: true },
  ];
  return zip(files.filter((f) => !(options.without ?? []).some((w) => f.name.endsWith(w))));
}
