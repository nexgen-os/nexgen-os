// A device connector: what a device measures, read as its series, and what
// is asked of it, carried out as a command (decision 0061).
//
// A charger, a heat pump, an inverter, a battery or a P1 dongle is reached
// through its maker's platform, an aggregator or its local interface. The
// code that reaches it does two things and only two: it reads series of the
// device (`DeviceReadingsProvider`) and it carries out the commands of the
// `actions` module asked of the device (`CommandCarrier`). It knows the
// device by an identifier in a scheme — the `identifiers` row of the device,
// a serial or a site id at the platform — and answers in the core's terms.
//
// `collectDeviceReadings()` is the one path from a provider to the series
// of a device, as `collectMeterReadings()` is for a meter.
// `carryCommands()` is the one path from the validated commands of a
// connector to the device and back: what the device answered is reported
// through `actions.report()`, which stores the value in its series when
// the device acknowledged it. A connector never writes a setpoint itself;
// deciding when to command a device is an application's.

import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';
import { storeSeries, type CollectedSeries } from './interfaces.js';

/** A device as the platform that reaches it knows it: its identifier in the scheme the connector reads. */
export interface DeviceOfSource {
  identifier: string;
  scheme: string;
  /** `device_types.code`: a charger, a heat pump, an inverter… */
  device_type: string;
}

/** What a reading of a device is given beside the device and the period. */
export interface DeviceReadingOptions {
  /** The step asked, an ISO 8601 duration (`PT15M`); the platform's own when absent. */
  step?: string;
  /** The quantities asked, by `quantities.code`; every one the platform has when absent. */
  quantities?: string[];
}

/**
 * Series of a device from the platform that reaches it, from `from` to `to`
 * (`YYYY-MM-DD`, `to` excluded): what it measured, each value dated at the
 * start of its interval. `collectDeviceReadings()` calls it and stores what
 * it returns on the device.
 */
export interface DeviceReadingsProvider {
  readonly source_code: string;
  /** The identifier scheme the platform names its devices by (`identifier_schemes.code`). */
  readonly scheme: string;
  readings(device: DeviceOfSource, from: string, to: string, options?: DeviceReadingOptions): Promise<CollectedSeries[]>;
}

/** A command of the `actions` module as a carrier receives it: what is asked of which device, when. */
export interface DeviceCommand {
  /** The action, to report on. */
  id: string;
  device: DeviceOfSource;
  /** The series the value is asked on: its quantity, its kind (`setpoint` or `command`) and its name. */
  quantity_code: string;
  series_kind: 'setpoint' | 'command';
  series_name: string | null;
  /** The value asked, in `unit`, the unit of its quantity. */
  value: number;
  unit: string;
  /** The instant it is asked for, ISO 8601 in UTC. */
  due_at: string;
}

/** What the device answered: the instant it acknowledged the command, or why it did not. */
export type CommandAnswer = { acknowledged_at: string } | { failure: string };

/**
 * Carries out a command on a device and says what the device answered. It
 * sends, it does not decide: the command was validated by a person before it
 * reaches a carrier.
 */
export interface CommandCarrier {
  readonly source_code: string;
  /** The identifier scheme the platform names its devices by (`identifier_schemes.code`). */
  readonly scheme: string;
  carry(command: DeviceCommand): Promise<CommandAnswer>;
}

/** Records what a device answered to a command; `actions.report()` by default. */
export type CommandReport = (db: Db, actionId: string, at: string, failure: string | null) => Promise<void>;

interface ConnectorRow { organisation_id: string; source_code: string }

async function connectorOf(db: Db, connectorId: string, sourceCode: string): Promise<ConnectorRow> {
  const connector = (await db.query<ConnectorRow>(
    `select organisation_id, source_code from connectors where id = $1`, [connectorId])).rows[0];
  if (!connector) throw new GestureError(`connector_not_found: ${connectorId}`);
  if (connector.source_code !== sourceCode) {
    throw new GestureError(`connector_source_mismatch: connector ${connectorId} reads ${connector.source_code}, not ${sourceCode}`);
  }
  return connector;
}

/**
 * The device as a platform knows it: its type and its identifier in the
 * scheme, of the connector's organisation. Refuses `device_not_found`,
 * `device_in_other_organisation`, `identifier_missing`.
 */
export async function deviceOfSource(db: Db, deviceId: string, scheme: string, organisationId: string): Promise<DeviceOfSource> {
  const device = (await db.query<{ organisation_id: string; device_type: string }>(
    `select organisation_id, device_type from devices where id = $1`, [deviceId])).rows[0];
  if (!device) throw new GestureError(`device_not_found: ${deviceId}`);
  if (device.organisation_id !== organisationId) {
    throw new GestureError(`device_in_other_organisation: device ${deviceId} is not of the connector's organisation`);
  }
  const identifier = (await db.query<{ value: string }>(
    `select value from identifiers
      where object_kind = 'device' and object_id = $1 and scheme = $2
        and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to > now())
      order by valid_from desc nulls last limit 1`, [deviceId, scheme])).rows[0];
  if (!identifier) throw new GestureError(`identifier_missing: device ${deviceId} has no ${scheme} identifier`);
  return { identifier: identifier.value, scheme, device_type: device.device_type };
}

export interface DeviceReadingRequest {
  /** The organisation's `connectors` row of the provider's source. */
  connectorId: string;
  deviceId: string;
  /** The readings asked for, `YYYY-MM-DD`, `to` excluded. */
  from: string;
  to: string;
  step?: string;
  quantities?: string[];
}

/**
 * Reads a device through a connector and keeps what it brought as the
 * measured series of the device, each carrying the connector's source. The
 * device is found by its identifier in the provider's scheme; nothing is
 * written when the connector, the device or its identifier is refused.
 */
export async function collectDeviceReadings(
  db: Db,
  provider: DeviceReadingsProvider,
  request: DeviceReadingRequest,
): Promise<{ stored: { quantity_code: string; seriesId: string; inserted: number }[] }> {
  const connector = await connectorOf(db, request.connectorId, provider.source_code);
  const device = await deviceOfSource(db, request.deviceId, provider.scheme, connector.organisation_id);
  const collected = await provider.readings(device, request.from, request.to, {
    ...(request.step ? { step: request.step } : {}), ...(request.quantities ? { quantities: request.quantities } : {}),
  });
  const stored = [];
  for (const series of collected) {
    const { seriesId, inserted } = await storeSeries(db, {
      organisationId: connector.organisation_id, objectKind: 'device', objectId: request.deviceId,
      sourceCode: provider.source_code, kind: 'measured',
    }, series);
    stored.push({ quantity_code: series.quantity_code, seriesId, inserted });
  }
  return { stored };
}

/** `actions.report()`: acknowledged, the command is done and its value stored in its series; with a failure, it failed and says why. */
export const reportCommand: CommandReport = async (db, actionId, at, failure) => {
  await db.query(`select actions.report($1, $2::timestamptz, $3)`, [actionId, at, failure]);
};

export interface CarryRequest {
  /** The organisation's `connectors` row of the carrier's source: the commands that name it are carried. */
  connectorId: string;
  /** Carries the validated commands due at this instant or before (ISO 8601); now when absent. */
  until?: string;
  /**
   * How an answer is recorded: `actions.report()` by default. A module that
   * keeps more of a command than its value — the schedule of a charging
   * profile — passes its own report, which calls `actions.report()`.
   */
  report?: CommandReport;
}

export interface CarriedCommand {
  id: string;
  device_id: string;
  status: 'done' | 'failed';
  acknowledged_at: string | null;
  failure: string | null;
}

/**
 * Carries out the validated commands of a connector that are due, the
 * earliest first, and reports each answer: acknowledged, the command is done
 * and its value lands in its series; refused, not acknowledged, or a carrier
 * that threw, it failed with why, writes nothing and can be proposed again
 * (`actions.move(action, 'proposed')`). A command whose device has no
 * identifier in the carrier's scheme fails with `identifier_missing`.
 * Refuses `module_not_installed` without the `actions` module,
 * `connector_not_found`, `connector_source_mismatch`.
 */
export async function carryCommands(db: Db, carrier: CommandCarrier, request: CarryRequest): Promise<{ carried: CarriedCommand[] }> {
  const installed = (await db.query<{ ok: boolean }>(`select to_regclass('actions.actions') is not null ok`)).rows[0]!.ok;
  if (!installed) throw new GestureError('module_not_installed: commands are actions of the actions module, which is not installed');
  const connector = await connectorOf(db, request.connectorId, carrier.source_code);
  const report = request.report ?? reportCommand;
  const due = (await db.query<{
    id: string; device_id: string; quantity_code: string; series_kind: 'setpoint' | 'command'; series_name: string | null;
    value: number; unit: string; due_at: string;
  }>(
    `select a.id, a.object_id device_id, s.quantity_code, s.kind series_kind, s.name series_name, a.value, q.unit,
            to_char(a.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') due_at
       from actions.actions a
       join series s on s.id = a.series_id
       join quantities q on q.code = s.quantity_code
      where a.kind = 'command' and a.status = 'validated' and a.connector_id = $1
        and a.due_at <= coalesce($2::timestamptz, now())
      order by a.due_at, a.id`, [request.connectorId, request.until ?? null])).rows;
  const carried: CarriedCommand[] = [];
  for (const command of due) {
    let answer: CommandAnswer;
    try {
      const device = await deviceOfSource(db, command.device_id, carrier.scheme, connector.organisation_id);
      answer = await carrier.carry({
        id: command.id, device, quantity_code: command.quantity_code, series_kind: command.series_kind,
        series_name: command.series_name, value: Number(command.value), unit: command.unit, due_at: command.due_at,
      });
    } catch (error) {
      answer = { failure: error instanceof Error ? error.message : String(error) };
    }
    if ('acknowledged_at' in answer) {
      await report(db, command.id, answer.acknowledged_at, null);
      carried.push({ id: command.id, device_id: command.device_id, status: 'done', acknowledged_at: answer.acknowledged_at, failure: null });
    } else {
      const failure = answer.failure.trim() || 'not acknowledged';
      await report(db, command.id, new Date().toISOString(), failure);
      carried.push({ id: command.id, device_id: command.device_id, status: 'failed', acknowledged_at: null, failure });
    }
  }
  return { carried };
}
