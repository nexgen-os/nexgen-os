/**
 * The WeSmart Database read into the one plain shape of an imported history
 * (`HistoryDescription` of `@nexgen-os/core`), which `importHistory()` writes
 * into a Nexgen OS installation, again every night, and reconciles per
 * participant and per month.
 *
 * Read only: every query runs in one transaction opened `read only` and
 * rolled back, so the database read cannot be written through this package,
 * whatever the rights of the connection. Nothing is logged; what could not be
 * described is returned in `skipped`, by the id of its record and the name of
 * its reason, never by a name, a place or a metering point.
 *
 * What the platform keeps, and how it lands:
 * - `organisations` → an organisation, by its record id (scheme `wesmart_database`);
 * - `projects` of an organisation → a project, its country the project's own;
 * - `participants` → a participant, with its place (address, point) and the
 *   time zone the caller names (the platform keeps none); its `smart_meter_id`,
 *   18 digits, a meter of scheme `gs1_gsrn`, measuring both ways;
 * - `devices` → a device, its type in the core's vocabulary, its power;
 * - `dso_meter_readings` → the meter's `offtake_energy` and
 *   `injection_energy`, a quarter-hour each, dated at its start, in kWh
 *   (offtake is `offtake_kwh` and `consumption_kwh`, the two columns the
 *   platform has written it in);
 * - `connector_mandates` → a mandate of the meter (`grid` module), sent,
 *   approved or refused as the platform recorded it.
 */
import { readFileSync } from 'node:fs';
import type {
  Db, DeviceDescription, HistoryDescription, MandateHistory, MeterReadings, OrganisationHistory,
  ParticipantDescription, ProjectDescription, SourceRow,
} from '@nexgen-os/core';

/** The `sources` row this package ships (`source.json`): write it with `registerSource()`. */
export const wesmartDatabaseSource: SourceRow = JSON.parse(readFileSync(new URL('../source.json', import.meta.url), 'utf8')) as SourceRow;

/** The `identifier_schemes` row of the platform's record ids (`scheme.json`). */
export const wesmartDatabaseScheme: { code: string; name: string; description: string; pattern: string; published_by: string } =
  JSON.parse(readFileSync(new URL('../scheme.json', import.meta.url), 'utf8'));

/** Writes the identifier scheme this package ships, once, as the owner of the installation (beside `registerSource()`). */
export async function registerWesmartDatabaseScheme(db: Db): Promise<void> {
  const s = wesmartDatabaseScheme;
  await db.query(
    `insert into identifier_schemes (code, name, description, pattern, published_by) values ($1, $2, $3, $4, $5)
     on conflict (code) do update set name = excluded.name, description = excluded.description, pattern = excluded.pattern
     where identifier_schemes.published_by = excluded.published_by`,
    [s.code, s.name, s.description, s.pattern, s.published_by]);
}

/** The platform's device types in the core's `device_types`; an electric vehicle is no device of a place. */
export const DEVICE_TYPES: Record<string, string> = {
  solar: 'solar', wind: 'wind', battery: 'battery', ev_charger: 'charger', hydrogen: 'hydrogen',
  heatpump: 'heat_pump', heat_pump: 'heat_pump', geothermal: 'geothermal', chp: 'cogeneration',
  parking_canopy: 'parking_canopy', boiler: 'boiler', biomass: 'biomass',
};

/** The platform's mandate granularities as ISO 8601 durations. */
const GRANULARITIES: Record<string, string> = { '15min': 'PT15M', hourly: 'PT1H', daily: 'P1D', monthly: 'P1M' };

/** The platform's mandate statuses in the `grid` module's; the others (expired, revoked, error) are skipped. */
const MANDATE_STATUSES: Record<string, MandateHistory['status']> = {
  pending: 'sent', url_generated: 'sent', email_sent: 'sent', reminder_sent: 'sent', approved: 'approved', rejected: 'refused',
};

export interface WesmartReadOptions {
  /** The IANA time zone of the participants: the platform keeps none, its own queries name one. Required. */
  timeZone: string;
  /** Only these organisations, by their record ids. All when absent. */
  organisations?: string[];
  /** The readings from this instant (included) to that one (excluded), ISO 8601; all when absent. */
  from?: string;
  to?: string;
}

/** What could not be described, by the id of its record and the name of its reason. */
export interface Skipped {
  kind: 'project' | 'participant' | 'meter' | 'device' | 'mandate';
  ref: string;
  reason: 'organisation_missing' | 'meter_identifier_unknown' | 'meter_shared' | 'device_type_unknown' | 'mandate_closed' | 'meter_missing';
}

export interface WesmartRead {
  history: HistoryDescription;
  skipped: Skipped[];
}

const SCHEME = 'wesmart_database';
const EAN = /^[0-9]{18}$/;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const day = (v: unknown) => (v === null || v === undefined ? undefined : new Date(v as string).toISOString().slice(0, 10));
const ids = (ref: string) => [{ scheme: SCHEME, value: ref }];

type Row = Record<string, unknown>;

/**
 * Reads the platform's organisations and all they hold, in one read-only
 * transaction rolled back at the end: see the head of this file.
 */
export async function readWesmartDatabase(source: Db, options: WesmartReadOptions): Promise<WesmartRead> {
  if (typeof options.timeZone !== 'string' || options.timeZone === '') throw new Error('time_zone_required: name the time zone of the participants');
  await source.query('begin transaction read only');
  try {
    return await read(source, options);
  } finally {
    await source.query('rollback');
  }
}

async function read(source: Db, options: WesmartReadOptions): Promise<WesmartRead> {
  const q = async (sql: string, params: unknown[] = []) => (await source.query<Row>(sql, params)).rows;
  const only = options.organisations ?? null;
  const skipped: Skipped[] = [];

  const organisations = await q('select id::text, name from organisations where $1::uuid[] is null or id = any($1::uuid[]) order by created_at, id', [only]);
  const projects = await q(
    `select id::text, organisation_id::text, name, country, start_date from projects
      where ($1::uuid[] is null or organisation_id = any($1::uuid[])) order by created_at, id`, [only]);
  const participants = await q(
    `select p.id::text, p.project_id::text, p.name, p.address, p.postal_code, p.city, p.country, p.latitude, p.longitude,
            p.smart_meter_id, p.join_date, pr.category
       from participants p left join profiles pr on pr.id::text = p.profile_id
      where p.project_id = any($1::uuid[]) order by p.created_at, p.id`, [projects.map((p) => p.id)]);
  const devices = await q(
    `select id::text, participant_id::text, name, device_type, power, installation_date from devices
      where participant_id = any($1::uuid[]) order by created_at, id`, [participants.map((p) => p.id)]);

  const history: HistoryDescription = { source_code: wesmartDatabaseSource.code, scheme: SCHEME, organisations: [], readings: [], mandates: [] };
  const byOrganisation = new Map<string, OrganisationHistory>();
  for (const o of organisations) {
    const organisation: OrganisationHistory = { ref: String(o.id), name: String(o.name), projects: [] };
    byOrganisation.set(organisation.ref, organisation);
    history.organisations.push(organisation);
  }

  /** The meter each participant record carries, by its record id. */
  const meterOf = new Map<string, string>();
  for (const p of projects) {
    const organisation = byOrganisation.get(String(p.organisation_id));
    if (organisation === undefined) {
      skipped.push({ kind: 'project', ref: String(p.id), reason: 'organisation_missing' });
      continue;
    }
    const project: ProjectDescription = {
      name: String(p.name), country: String(p.country ?? ''), identifiers: ids(String(p.id)), participants: [],
      ...(day(p.start_date) ? { start_date: day(p.start_date)! } : {}),
    };
    organisation.projects.push(project);
    const carried = new Set<string>();
    for (const r of participants.filter((x) => x.project_id === p.id)) {
      const ref = String(r.id);
      const participant: ParticipantDescription = {
        name: String(r.name), time_zone: options.timeZone, identifiers: ids(ref), meters: [], devices: [],
        category: r.category === 'producer' ? 'producer' : 'consumer',
        place: placeOf(r, project.country),
      };
      const ean = typeof r.smart_meter_id === 'string' ? r.smart_meter_id.trim() : '';
      if (ean !== '' && !EAN.test(ean)) skipped.push({ kind: 'meter', ref, reason: 'meter_identifier_unknown' });
      else if (ean !== '' && carried.has(ean)) skipped.push({ kind: 'meter', ref, reason: 'meter_shared' });
      else if (ean !== '') {
        carried.add(ean);
        meterOf.set(ref, ean);
        participant.meters!.push({ identifier: ean, scheme: 'gs1_gsrn', direction: 'both', ...(day(r.join_date) ? { valid_from: day(r.join_date)! } : {}) });
      }
      for (const d of devices.filter((x) => x.participant_id === r.id)) {
        const type = DEVICE_TYPES[String(d.device_type)];
        if (type === undefined) {
          skipped.push({ kind: 'device', ref: String(d.id), reason: 'device_type_unknown' });
          continue;
        }
        const device: DeviceDescription = {
          device_type: type, name: String(d.name ?? `${type} ${String(d.id).slice(0, 8)}`), identifiers: ids(String(d.id)),
          source_code: wesmartDatabaseSource.code,
          ...(num(d.power) !== undefined && num(d.power)! > 0 ? { rated_power_kw: num(d.power)! } : {}),
          ...(day(d.installation_date) ? { installed_on: day(d.installation_date)! } : {}),
        };
        participant.devices!.push(device);
      }
      project.participants!.push(participant);
    }
  }

  // Readings: a quarter-hour each, dated at its start, read per participant carrying a meter.
  for (const [participantRef, ean] of meterOf) {
    const rows = await q(
      `select "timestamp" at, coalesce(offtake_kwh, 0) + coalesce(consumption_kwh, 0) offtake, injection_kwh injection
         from dso_meter_readings
        where participant_id = $1::uuid and ($2::timestamptz is null or "timestamp" >= $2) and ($3::timestamptz is null or "timestamp" < $3)
        order by "timestamp"`, [participantRef, options.from ?? null, options.to ?? null]);
    if (rows.length === 0) continue;
    const at = (r: Row) => new Date(r.at as string).toISOString();
    const series = (quantity: string, column: string): MeterReadings => ({
      scheme: 'gs1_gsrn', identifier: ean, quantity_code: quantity, step: '15 minutes',
      values: rows.filter((r) => r[column] !== null).map((r) => ({ at: at(r), value: Number(r[column]) })),
    });
    for (const s of [series('offtake_energy', 'offtake'), series('injection_energy', 'injection')]) if (s.values.length > 0) history.readings!.push(s);
  }

  // Mandates of the meters described.
  const mandates = await q(
    `select id::text, participant_id::text, dso::text operator, status::text, data_granularity, data_start_date, data_end_date,
            approved_at, created_at, external_id
       from connector_mandates where participant_id = any($1::uuid[]) order by created_at, id`, [[...meterOf.keys()]]);
  for (const m of mandates) {
    const ean = meterOf.get(String(m.participant_id));
    const status = MANDATE_STATUSES[String(m.status)];
    if (ean === undefined) skipped.push({ kind: 'mandate', ref: String(m.id), reason: 'meter_missing' });
    else if (status === undefined) skipped.push({ kind: 'mandate', ref: String(m.id), reason: 'mandate_closed' });
    else {
      history.mandates!.push({
        scheme: 'gs1_gsrn', identifier: ean, status, scope: ['load_curve'], purpose: 'sharing_operation',
        granularity: GRANULARITIES[String(m.data_granularity)] ?? 'PT15M',
        valid_from: day(m.approved_at ?? m.created_at)!,
        ...(m.operator !== 'other' ? { operator: String(m.operator) } : {}),
        data_from: day(m.data_start_date) ?? null, data_to: day(m.data_end_date) ?? null,
        external_reference: m.external_id === null || m.external_id === undefined ? null : String(m.external_id),
      });
    }
  }
  return { history, skipped };
}

/** A participant's place in the standard shape (`placeFields()`): its address as the platform keeps it, its point when it has one. */
function placeOf(r: Row, projectCountry: string): Record<string, unknown> {
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  return {
    address_line1: r.address ?? null, postal_code: r.postal_code ?? null, city: r.city ?? null,
    country: String(r.country ?? projectCountry),
    ...(lat !== undefined && lon !== undefined ? { geometry: { type: 'Point', coordinates: [lon, lat, 0] } } : {}),
  };
}
