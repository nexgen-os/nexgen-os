// An aggregator connector: the activations an aggregator, a grid operator or
// an energy manager asked of the flexible devices it knows, kept as
// activations of the `flexibility` module (decision 0058).
//
// The platform knows a device by an identifier in its scheme, the
// `identifiers` row of the device, as a device connector does (decision
// 0061). A device is declared to the platform by that identifier and by
// its row in `flexibility.devices`, which says what it can be asked; nothing
// else is declared. `collectActivations()` is the one path from what the
// platform asked to the database: each activation goes through
// `flexibility.activate()`, checked against what the device declares and
// carried out as a proposed command of the `actions` module, which a person
// validates. What the device delivered is never sent back from here: it is
// read from the series of its meter.

import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';
import { connectorOf, type DeviceOfSource } from './devices.js';

/** An activation as the platform that asked it gives it. */
export interface ReceivedActivation {
  /** The device, by its identifier in the provider's scheme. */
  identifier: string;
  /** `up`: more injection or less offtake; `down`: the reverse, as the grid sees the device. */
  direction: 'up' | 'down';
  /** Its start and end, ISO 8601 with an offset. */
  start_at: string;
  end_at: string;
  /** The power asked, kW, a change from the operating point of the device. */
  requested_kw: number;
  /** The platform's reference of the activation: an activation is kept once per device and reference. */
  external_ref: string;
}

/**
 * The activations a platform asked of the devices it is given, between
 * `from` and `to` (ISO 8601 instants, `to` excluded).
 * `collectActivations()` calls it and keeps what it returns.
 */
export interface ActivationProvider {
  readonly source_code: string;
  /** The identifier scheme the platform names its devices by (`identifier_schemes.code`). */
  readonly scheme: string;
  /** The market role of who asks through this platform: `aggregator`, `grid_operator`, `energy_manager`… */
  readonly role: string;
  activations(devices: DeviceOfSource[], from: string, to: string): Promise<ReceivedActivation[]>;
}

export interface ActivationRequest {
  /** The organisation's `connectors` row of the provider's source. */
  connectorId: string;
  /** The activations asked for, ISO 8601 instants, `to` excluded. */
  from: string;
  to: string;
}

export interface CollectedActivation {
  external_ref: string;
  identifier: string;
  /** The device, when the identifier names one. */
  device_id: string | null;
  /** The activation kept, or the one kept before for the same device and reference. */
  activation_id: string | null;
  /** `kept`: a new activation and its proposed command; `already_received`: kept before; `refused`: nothing written. */
  status: 'kept' | 'already_received' | 'refused';
  /** Why it was refused, by name: `identifier_unknown`, `external_ref_required`, or what `flexibility.activate()` refuses. */
  refusal: string | null;
}

interface FlexibleDeviceRow { id: string; device_type: string; identifier: string }

/**
 * Asks the platform of a connector for the activations of the flexible
 * devices of its organisation that carry an identifier in the provider's
 * scheme, and keeps each as an activation of the `flexibility` module with
 * the provider's role and the platform's reference; its command is proposed
 * (`source = 'detector'`) and waits for a person. An activation received
 * again — same device, same reference — is not kept twice. One that names
 * an unknown identifier, has no reference or is refused by
 * `flexibility.activate()` writes nothing and says why, the others are kept.
 * Refuses `module_not_installed` without the `flexibility` module,
 * `connector_not_found`, `connector_source_mismatch`.
 */
export async function collectActivations(
  db: Db,
  provider: ActivationProvider,
  request: ActivationRequest,
): Promise<{ received: CollectedActivation[] }> {
  const installed = (await db.query<{ ok: boolean }>(`select to_regclass('flexibility.activations') is not null ok`)).rows[0]!.ok;
  if (!installed) throw new GestureError('module_not_installed: an activation is kept by the flexibility module, which is not installed');
  const connector = await connectorOf(db, request.connectorId, provider.source_code);

  const devices = (await db.query<FlexibleDeviceRow>(
    `select distinct on (d.id) d.id, d.device_type, i.value identifier
       from flexibility.devices f
       join devices d on d.id = f.id
       join identifiers i on i.object_kind = 'device' and i.object_id = d.id and i.scheme = $2
      where d.organisation_id = $1
        and (i.valid_from is null or i.valid_from <= now()) and (i.valid_to is null or i.valid_to > now())
      order by d.id, i.valid_from desc nulls last`, [connector.organisation_id, provider.scheme])).rows;
  if (devices.length === 0) return { received: [] };
  const byIdentifier = new Map(devices.map((d) => [d.identifier, d.id]));

  const asked = await provider.activations(
    devices.map((d) => ({ identifier: d.identifier, scheme: provider.scheme, device_type: d.device_type })),
    request.from, request.to);

  const received: CollectedActivation[] = [];
  for (const activation of asked) {
    const deviceId = byIdentifier.get(activation.identifier) ?? null;
    const base = { external_ref: activation.external_ref, identifier: activation.identifier, device_id: deviceId };
    if (!deviceId) {
      received.push({ ...base, activation_id: null, status: 'refused', refusal: 'identifier_unknown' });
      continue;
    }
    if (!activation.external_ref?.trim()) {
      received.push({ ...base, activation_id: null, status: 'refused', refusal: 'external_ref_required' });
      continue;
    }
    const before = (await db.query<{ id: string }>(
      `select id from flexibility.activations where device_id = $1 and external_ref = $2 order by created_at limit 1`,
      [deviceId, activation.external_ref])).rows[0];
    if (before) {
      received.push({ ...base, activation_id: before.id, status: 'already_received', refusal: null });
      continue;
    }
    try {
      const { id } = (await db.query<{ id: string }>(
        `select flexibility.activate($1, $2, $3::timestamptz, $4::timestamptz, $5, null, $6, $7, 'detector') id`,
        [deviceId, activation.direction, activation.start_at, activation.end_at, activation.requested_kw,
          provider.role, activation.external_ref])).rows[0]!;
      received.push({ ...base, activation_id: id, status: 'kept', refusal: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      received.push({ ...base, activation_id: null, status: 'refused', refusal: message.split(':')[0]!.trim() });
    }
  }
  return { received };
}
