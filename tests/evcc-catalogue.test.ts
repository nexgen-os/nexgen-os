// The products evcc's templates drive, in the catalogue: one entry per
// model with the templates it can be driven through, the sponsored ones and
// the brands without a model left out, an import replayed changing nothing,
// an entry already known keeping its values.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readEvccTemplate } from '@nexgen-os/evcc';
import { EVCC_DEVICE_TYPES, catalogueOfEvcc, deviceTypeOfEvcc, importEvccCatalogue } from '@nexgen-os/core';
import { USER_A, USER_B, asUser, freshDatabase, one, organisation } from './helpers/db.js';

const PATHS = ['charger/go-e-v3', 'charger/easee', 'charger/luxtronik', 'charger/mystrom', 'meter/dsmr', 'meter/fronius-gen24', 'meter/sma-hybrid', 'vehicle/renault'];
const read = (path: string) =>
  readEvccTemplate(readFileSync(new URL(`../packages/formats/evcc/tests/fixtures/${path}.yaml`, import.meta.url), 'utf8'), path.split('/')[0]!, { languages: ['en'] });
const templates = PATHS.map(read);
const revision = { repository: 'https://github.com/evcc-io/evcc', commit: 'c0e578acb1f93310824766a11c2be04e210e5509' };

describe('the device type of a template', () => {
  it('follows the class, the group and the uses, as the table says', () => {
    const type = (path: string) => deviceTypeOfEvcc(read(path));
    expect(['charger/go-e-v3', 'charger/luxtronik', 'charger/mystrom', 'meter/dsmr', 'meter/fronius-gen24', 'meter/sma-hybrid', 'vehicle/renault'].map(type))
      .toEqual(['charger', 'heat_pump', 'controller', 'meter', 'inverter', 'inverter', null]);
    expect(deviceTypeOfEvcc(read('charger/luxtronik'), { ...EVCC_DEVICE_TYPES, charger: { heating: null } })).toBeNull();
  });
});

describe('the entries the templates give', () => {
  const { entries, leftOut } = catalogueOfEvcc(templates);

  it('gives one entry per model of an open template, with the template it is driven through', () => {
    expect(entries.map((e) => `${e.deviceType} ${e.manufacturer} ${e.model}`)).toEqual([
      'heat_pump Buderus Logamatic HMC 20', 'heat_pump Buderus Logamatic HMC 20 Z', 'heat_pump CTA All-In-One Aeroplus', 'heat_pump Nibe AP-AW10',
      'heat_pump Roth ThermoAura', 'heat_pump Roth ThermoTerra', 'heat_pump Novelan WPR NET', 'heat_pump Wolf BWL', 'heat_pump Wolf BWS',
      'controller myStrom Switch', 'inverter Fronius Symo GEN24 Plus', 'inverter Fronius Primo GEN24 Plus', 'inverter SMA Smart Energy Hybrid Inverter',
    ]);
    expect(entries.find((e) => e.manufacturer === 'Fronius')!.connectors).toEqual([{
      class: 'meter', template: 'fronius-gen24', group: null, capabilities: ['battery-control', 'curtail'], usages: ['grid', 'pv', 'battery'],
      discovery: { mdns: ['_Fronius-SE-Inverter._tcp'], hostname: ['fronius*'], mac: ['0003AC'] },
    }]);
  });

  it('leaves out the sponsored templates, the brands without a model and what has no device type, saying why', () => {
    const count = (reason: string) => leftOut.filter((l) => l.reason === reason).length;
    expect([count('sponsored'), count('model_missing'), count('device_type_unknown')]).toEqual([11, 4, 0]);
    expect(leftOut.filter((l) => l.reason === 'model_missing').map((l) => `${l.template} ${l.brand}`))
      .toEqual(['luxtronik alpha innotec', 'luxtronik Elco', 'dsmr DSMR', 'renault Renault']);
  });

  it('folds two templates naming one model into one entry with both', () => {
    const ocpp = readEvccTemplate('template: fronius-ocpp\nproducts:\n  - brand: Fronius\n    description:\n      generic: Symo GEN24 Plus\n', 'meter');
    const fronius = catalogueOfEvcc([read('meter/fronius-gen24'), ocpp]).entries.find((e) => e.model === 'Symo GEN24 Plus')!;
    expect(fronius.connectors.map((c) => c.template)).toEqual(['fronius-gen24', 'fronius-ocpp']);
    expect(fronius.deviceType).toBe('inverter');
  });
});

describe('the catalogue written', () => {
  let db: PGlite;
  let org: string;

  beforeAll(async () => {
    db = await freshDatabase();
    org = await organisation(db, 'Installer');
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes an organisation its own entries, once, published by evcc with their commit and licence', async () => {
    const first = await asUser(db, USER_A, () => importEvccCatalogue(db, templates, { organisationId: org, revision }));
    expect(first).toMatchObject({ created: 13, updated: 0 });
    expect(first.leftOut).toHaveLength(15);
    const row = await one<{ device_type: string; published_by: string; metadata: { evcc: { commit: string; licence: string; connectors: { template: string }[] } } }>(
      db, `select device_type, published_by, metadata from products where organisation_id = $1 and manufacturer = 'SMA'`, [org]);
    expect(row).toMatchObject({ device_type: 'inverter', published_by: 'evcc', metadata: { evcc: { commit: revision.commit, licence: 'MIT', connectors: [{ template: 'sma-hybrid' }] } } });

    expect(await asUser(db, USER_A, () => importEvccCatalogue(db, templates, { organisationId: org, revision }))).toMatchObject({ created: 0, updated: 13 });
    expect(await one(db, 'select count(*)::int n from products where organisation_id = $1', [org])).toEqual({ n: 13 });
  });

  it('keeps the values of an entry already known and adds its templates', async () => {
    await db.query(
      `insert into products (organisation_id, device_type, manufacturer, model, unit_power_kw, metadata) values (null, 'inverter', 'Fronius', 'Primo GEN24 Plus', 6, '{"datasheet": "v2"}')`);
    expect(await importEvccCatalogue(db, [read('meter/fronius-gen24')], { organisationId: null, revision })).toMatchObject({ created: 1, updated: 1 });
    const known = await one<{ unit_power_kw: string; published_by: string; metadata: { datasheet: string; evcc: { connectors: unknown[] } } }>(
      db, `select unit_power_kw, published_by, metadata from products where organisation_id is null and model = 'Primo GEN24 Plus'`);
    expect(known).toMatchObject({ unit_power_kw: '6.000', published_by: 'core', metadata: { datasheet: 'v2' } });
    expect(known.metadata.evcc.connectors).toHaveLength(1);
  });

  it('writes shared entries for whoever installs, never for a member of an organisation, and names the commit it read', async () => {
    await expect(asUser(db, USER_B, () => importEvccCatalogue(db, templates, { organisationId: null, revision }))).rejects.toThrow();
    await expect(importEvccCatalogue(db, templates, { organisationId: org, revision: { repository: revision.repository, commit: '' } })).rejects.toThrow(/^revision_required/);
  });
});
