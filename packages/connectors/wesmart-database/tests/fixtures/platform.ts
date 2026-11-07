// A made-up platform: the tables and columns of the WeSmart Database the
// reader reads, nothing more, and one organisation, one project, three
// participant records, their devices, readings and mandates, all invented.
import { PGlite } from '@electric-sql/pglite';

export const ORG = '0a000000-0000-4000-8000-000000000001';
export const PROJECT = '0b000000-0000-4000-8000-000000000001';
export const LONELY_PROJECT = '0b000000-0000-4000-8000-000000000002';
export const SCHOOL = '0c000000-0000-4000-8000-000000000001';
export const HOUSE = '0c000000-0000-4000-8000-000000000002';
export const PV_RECORD = '0c000000-0000-4000-8000-000000000003';
export const EAN_SCHOOL = '541448000000000017';
export const EAN_HOUSE = '541448000000000024';
export const NAMES = ['Example Cooperative', 'Demo Sharing', 'Example School', 'Example House', 'Rue de l’Exemple 1'];

export const SOURCE_SCHEMA = `
  create table organisations (id uuid primary key, name text, created_at timestamptz default now());
  create table projects (id uuid primary key, organisation_id uuid, name text, country text, start_date date, created_at timestamptz default now());
  create table profiles (id text primary key, category text);
  create table participants (id uuid primary key, project_id uuid, name text, address text, postal_code text, city text, country text,
    latitude numeric, longitude numeric, smart_meter_id text, join_date date, profile_id text, created_at timestamptz default now());
  create table devices (id uuid primary key, participant_id uuid, name text, device_type text, power numeric, installation_date date,
    created_at timestamptz default now());
  create table dso_meter_readings (participant_id uuid, "timestamp" timestamptz, offtake_kwh numeric, consumption_kwh numeric,
    injection_kwh numeric, primary key (participant_id, "timestamp"));
  create table connector_mandates (id uuid primary key, participant_id uuid, dso text, status text, data_granularity text,
    data_start_date date, data_end_date date, approved_at timestamptz, created_at timestamptz default now(), external_id text);
`;

/** Quarter-hours from 31 January 22:00 UTC to 1 February 02:00 UTC: across the end of a month in Brussels (UTC+1). */
async function seedReadings(source: PGlite, participant: string, offtake: number, injection: number) {
  await source.query(
    `insert into dso_meter_readings (participant_id, "timestamp", consumption_kwh, injection_kwh)
     select $1, t, $2, $3 from generate_series('2026-01-31T22:00:00Z'::timestamptz, '2026-02-01T01:45:00Z', interval '15 minutes') t`,
    [participant, offtake, injection]);
}

/** The made-up platform, in a database of its own. */
export async function madeUpPlatform(): Promise<PGlite> {
  const source = new PGlite();
  await source.exec(SOURCE_SCHEMA);
  await source.query(`insert into organisations (id, name) values ($1, 'Example Cooperative')`, [ORG]);
  await source.query(`insert into projects (id, organisation_id, name, country, start_date) values ($1, $2, 'Demo Sharing', 'BE', '2026-01-01'), ($3, null, 'Orphan', 'BE', null)`,
    [PROJECT, ORG, LONELY_PROJECT]);
  await source.query(`insert into profiles (id, category) values ('school', 'consumer'), ('pv', 'producer')`);
  await source.query(
    `insert into participants (id, project_id, name, address, postal_code, city, country, latitude, longitude, smart_meter_id, join_date, profile_id) values
      ($1, $4, 'Example School', 'Rue de l’Exemple 1', '1000', 'Bruxelles', 'BE', 50.85, 4.35, $5, '2026-01-01', 'school'),
      ($2, $4, 'Example House', 'Rue de l’Exemple 3', '1000', 'Bruxelles', 'BE', null, null, $6, '2026-01-01', null),
      ($3, $4, 'PV - Example School', 'Rue de l’Exemple 1', '1000', 'Bruxelles', 'BE', 50.85, 4.35, $5, '2026-01-01', 'pv')`,
    [SCHOOL, HOUSE, PV_RECORD, PROJECT, EAN_SCHOOL, EAN_HOUSE]);
  await source.query(
    `insert into devices (id, participant_id, name, device_type, power, installation_date) values
      ('0d000000-0000-4000-8000-000000000001', $1, 'Roof PV', 'solar', 36, '2025-06-01'),
      ('0d000000-0000-4000-8000-000000000002', $1, 'Bus', 'ev', null, null),
      ('0d000000-0000-4000-8000-000000000003', $2, 'Heat pump', 'heatpump', 6, null)`, [SCHOOL, HOUSE]);
  await seedReadings(source, SCHOOL, 1.25, 0.5);
  await seedReadings(source, HOUSE, 0.25, 0);
  await source.query(
    `insert into connector_mandates (id, participant_id, dso, status, data_granularity, data_start_date, approved_at, external_id) values
      ('0e000000-0000-4000-8000-000000000001', $1, 'sibelga', 'approved', '15min', '2026-01-01', '2026-01-05T09:00:00Z', 'OP-REF-1'),
      ('0e000000-0000-4000-8000-000000000002', $2, 'sibelga', 'revoked', '15min', '2026-01-01', null, null)`, [SCHOOL, HOUSE]);

  return source;
}
