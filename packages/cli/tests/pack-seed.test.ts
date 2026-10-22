// The compiled seed of the fixture pack, applied to the tables it assumes:
// idempotent, a new version reaching an installation, a value never edited,
// a row of another publisher left alone, every refusal by name.
//
// The tables below are the shapes the compiler writes into — `countries`,
// `regions` and `defaults` of the core, the operator table of the `grid`
// module, and the columns of `sources`, `identifier_schemes` and
// `project_kinds` it fills, with the one function it calls (the unit of a
// quantity, the price's currency left aside). They are
// stand-ins, reduced to what a seed touches: the contract between the
// compiler and the core, checked here without installing the core.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compilePack, readPack, readSchema } from '../src/index.js';
import { FIXTURE, checkout, edit } from './pack-checkout.js';

const TABLES = `
create schema nexgen;
create schema grid;
set search_path = nexgen, extensions, public;
create table quantities (code text primary key, unit text not null);
create table attribute_types (code text primary key, datatype text not null, quantity_code text references quantities(code));
create table sources (
  code text primary key, name text not null, description text, kind text not null, base_url text, docs_url text,
  auth text not null, countries text[] not null, regions text[] not null, license text, attribution text,
  retention_days integer, redistributable boolean not null, published_by text not null);
create table identifier_schemes (
  code text primary key, name text not null, description text, pattern text, url_template text,
  source_code text references sources(code), icd text, published_by text not null);
create table currencies (
  code char(3) primary key, name text not null, symbol text, decimal_places smallint not null default 2, active boolean not null default true);
create table countries (
  code char(2) primary key, name text not null, currency char(3) not null references currencies(code), languages text[] not null,
  time_zones text[] not null, region_level text not null, postal_code_pattern text,
  municipality_scheme text references identifier_schemes(code), bbox double precision[], pack_version text, pack_checksum text,
  published_by text not null);
create table regions (
  code text primary key, country char(2) not null references countries(code), name text not null,
  kind text not null default 'subdivision', parent text references regions(code), time_zone text,
  names jsonb not null default '{}', aliases text[] not null default '{}', postal_prefixes text[] not null default '{}', published_by text not null);
create table project_kinds (
  code text primary key, name text not null, description text, parent_code text, country char(2),
  source_code text references sources(code), reference text, published_by text not null);
create function quantity_unit(p_quantity text, p_currency text) returns text language sql
  as 'select unit from nexgen.quantities where code = p_quantity';
create table defaults (
  id uuid primary key default gen_random_uuid(),
  attribute_type text not null references attribute_types(code),
  country char(2) not null references countries(code), region text references regions(code),
  condition jsonb not null default '{}',
  value jsonb, valid_from date, valid_to date,
  source_code text not null references sources(code), reference text, status text not null default 'published', published_by text not null,
  unique nulls not distinct (country, region, attribute_type, condition, valid_from));
create table grid.operators (
  code text primary key, name text not null, kind text not null, country char(2) not null,
  regions text[] not null, municipalities text[] not null, identifier_prefixes text[] not null, coverage text, website text, data_hub_url text, meter_data jsonb not null default '{}',
  identifier_scheme text references nexgen.identifier_schemes(code), eic_code text, description text, published_by text not null);
insert into quantities values ('power', 'KiloW'), ('length', 'M'), ('emission_factor', 'KiloGM-PER-KiloW-HR');
insert into attribute_types values
  ('connection_max_power_lv', 'number', 'power'), ('grid_co2_factor', 'number', 'emission_factor'),
  ('metering_step', 'text', null), ('offpeak_hours', 'json', null), ('density_class', 'text', null),
  ('sharing_max_distance_m', 'number', 'length'), ('voltage_levels', 'json', null);
`;

async function seedOf(change?: (root: string) => Promise<void>): Promise<string> {
  const root = await checkout();
  if (change) await change(root);
  const reading = await readPack(root, 'xa', await readSchema(root));
  expect(reading.problems).toEqual([]);
  return compilePack(reading.pack!);
}

describe('the seed of a pack on a database', () => {
  let db: PGlite;
  const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0]!.n;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(TABLES);
  });
  afterEach(async () => {
    await db.close();
  });

  it('writes every section, and a second run changes nothing', async () => {
    const seed = await readFile(join(FIXTURE, 'supabase/seed/10_pack_xa.sql'), 'utf8');
    for (let run = 0; run < 2; run += 1) {
      await db.exec(seed);
      expect([await count('sources'), await count('identifier_schemes'), await count('countries'), await count('regions'), await count('grid.operators'), await count('defaults'),
        await count('project_kinds')])
        .toEqual([3, 2, 1, 5, 3, 10, 1]);
    }
    const country = (await db.query<Record<string, unknown>>('select currency, time_zones, pack_version, pack_checksum from countries')).rows[0];
    expect(country).toMatchObject({ currency: 'XTS', time_zones: ['Etc/UTC', 'Etc/GMT-1'], pack_version: '0.1.0' });
    expect(seed).toContain(`-- checksum       ${country!.pack_checksum}`);
    const step = await db.query<{ value: string; valid_to: Date | null }>(
      "select value, valid_to from defaults where attribute_type = 'metering_step' order by valid_from");
    expect(step.rows.map((r) => [r.value, r.valid_to?.toISOString().slice(0, 10) ?? null])).toEqual([['PT30M', '2025-01-01'], ['PT15M', null]]);
    expect((await db.query("select value from defaults where attribute_type = 'offpeak_hours'")).rows).toEqual([{ value: null }]);
  });

  it('brings a new version to an installation: a period closed, a value added, the version recorded', async () => {
    await db.exec(await readFile(join(FIXTURE, 'supabase/seed/10_pack_xa.sql'), 'utf8'));
    await db.exec(await seedOf(async (root) => {
      await edit(root, 'pack.json', (j) => { j.version = '0.2.0'; });
      await edit(root, 'defaults.json', (j) => {
        j.defaults[2].valid_to = '2027-01-01';
        j.defaults.push({ ...j.defaults[2], value: 0.1, valid_from: '2027-01-01', valid_to: undefined });
      });
    }));
    const rows = await db.query<{ value: number; valid_to: Date | null }>(
      "select value, valid_to from defaults where attribute_type = 'grid_co2_factor' order by valid_from");
    expect(rows.rows.map((r) => [r.value, r.valid_to?.toISOString().slice(0, 10) ?? null])).toEqual([[0.12, '2027-01-01'], [0.1, null]]);
    expect((await db.query<{ pack_version: string }>('select pack_version from countries')).rows[0]!.pack_version).toBe('0.2.0');
  });

  it('refuses a value edited in place, and writes nothing of that seed', async () => {
    await db.exec(await readFile(join(FIXTURE, 'supabase/seed/10_pack_xa.sql'), 'utf8'));
    const edited = await seedOf(async (root) => {
      await edit(root, 'pack.json', (j) => { j.version = '0.2.0'; });
      await edit(root, 'defaults.json', (j) => { j.defaults[2].value = 0.2; });
    });
    await expect(db.exec(edited)).rejects.toThrow(
      'value_edited: grid_co2_factor from 2026-01-01 holds 0.12 and the pack says 0.2; close it with valid_to and add a row');
    expect((await db.query<{ pack_version: string }>('select pack_version from countries')).rows[0]!.pack_version).toBe('0.1.0');
  });

  it('refuses an unknown attribute type and a unit that is not the attribute type\'s, by name', async () => {
    const seed = await seedOf(async (root) => {
      await edit(root, 'grid.json', (j) => { j.thresholds[0].unit = 'W'; });
      await edit(root, 'defaults.json', (j) => { j.defaults[0].attribute_type = 'metering_interval'; j.defaults[1].attribute_type = 'metering_interval'; });
    });
    await expect(db.exec(seed)).rejects.toThrow(
      /^attribute_type_unknown: metering_interval is not an attribute_types code; attribute_type_unknown: metering_interval .*; unit_mismatch: connection_max_power_lv is stored in KiloW and the pack says W$/);
    expect(await count('countries')).toBe(0);
  });

  it('leaves a row another publisher holds as it is', async () => {
    await db.exec(`insert into sources (code, name, kind, auth, countries, regions, redistributable, published_by)
                   values ('xa_statistics', 'Kept by the core', 'file', 'none', '{}', '{}', true, 'core')`);
    await db.exec(await readFile(join(FIXTURE, 'supabase/seed/10_pack_xa.sql'), 'utf8'));
    expect((await db.query("select name, published_by from sources where code = 'xa_statistics'")).rows).toEqual([{ name: 'Kept by the core', published_by: 'core' }]);
  });
});
