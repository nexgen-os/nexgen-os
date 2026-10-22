/**
 * An energy bill in the model, once read.
 *
 * `@nexgen-os/energy-bill` reads the energy of a bill from the invoice a
 * generic reader returned; these gestures write what it read about the
 * objects of the core, each fact once, each with the bill as its source:
 *
 *   - `attachBill()`   the bill itself, a `documents` row of the participant
 *                      with its checksum: the same file is imported once;
 *   - `meterOfBill()`  the connection point, found by its identifier in the
 *                      participant's project, declared when it is not;
 *   - `tariffOfBill()` the contract as the bill prices it, attributes of the
 *                      participant and of the meter, status `published`.
 *
 * The energy over the bill's period is the `consumption` module's
 * (`estimateFromBill()`), the record of the invoice the `billing`
 * module's (`billing.record_invoice()`, kind `purchase`). kWh stay kWh; a
 * price is kept per MWh, the unit of `energy_price`, in the currency of the
 * participant's country, which must be the bill's.
 */
import { meanProjectedPrice, type EnergyBillReading } from '@nexgen-os/energy-bill';
import type { Db } from '../db.js';

/** The file of the bill: where it is kept and its checksum, `sha256:<hex>`. */
export interface BillFile {
  name: string;
  uri: string;
  checksum: string;
  mediaType?: string | null;
  byteSize?: number | null;
  /** The invoice in Ekwo OS this bill was read into, when it was. */
  ekwoInvoiceId?: string | null;
}

const CHECKSUM = /^sha256:[0-9a-f]{64}$/;

/**
 * Attaches the bill to the participant, with its checksum and what the
 * reading says it is. Refuses `checksum_required` and, for a file already
 * attached to the participant, `already_imported`. Returns the document's id.
 */
export async function attachBill(db: Db, participantId: string, reading: EnergyBillReading, file: BillFile): Promise<string> {
  if (!CHECKSUM.test(file.checksum)) throw new Error('checksum_required: a bill is attached with its checksum, sha256:<hex>');
  const existing = (await db.query<{ id: string }>(
    `select id from documents where object_kind = 'participant' and object_id = $1 and checksum = $2`, [participantId, file.checksum])).rows[0];
  if (existing) throw new Error(`already_imported: the bill is document ${existing.id} of the participant`);
  const { invoice } = reading;
  const source = `invoice ${invoice.number} of ${invoice.issueDate}${invoice.seller.name ? ` from ${invoice.seller.name}` : ''}`;
  const id = (await db.query<{ id: string }>(
    `select attach_document('participant', $1, $2, 'document', $3, $4, null, $5, $6::date::timestamptz, $7, $8) id`,
    [participantId, file.name, file.uri, file.mediaType ?? null, source, invoice.issueDate, file.byteSize ?? null, file.checksum])).rows[0]!.id;
  const metadata = {
    invoice: { number: invoice.number, issue_date: invoice.issueDate, kind: invoice.kind, currency: invoice.currency, seller: invoice.seller, period: reading.period },
    ekwo_invoice_id: file.ekwoInvoiceId ?? null,
  };
  await db.query('update documents set metadata = $2::jsonb where id = $1', [id, JSON.stringify(metadata)]);
  return id;
}

/**
 * The meter the bill is for: the open connection point of the participant's
 * project with the bill's scheme and identifier, declared for the
 * participant when there is none — never a second one. Refuses
 * `meter_required` (the bill names no meter) and
 * `meter_of_other_participant`.
 */
export async function meterOfBill(db: Db, participantId: string, reading: EnergyBillReading): Promise<{ meterId: string; found: boolean }> {
  const meter = reading.meter;
  if (!meter) throw new Error('meter_required: the bill names no meter');
  const open = (await db.query<{ id: string; participant_id: string }>(
    `select m.id, m.participant_id from meters m join participants p on p.project_id = m.project_id
      where p.id = $1 and m.scheme = $2 and m.identifier = $3 and m.valid_to is null`,
    [participantId, meter.scheme, meter.identifier])).rows[0];
  if (open && open.participant_id !== participantId) {
    throw new Error(`meter_of_other_participant: ${meter.scheme} ${meter.identifier} is carried by participant ${open.participant_id}`);
  }
  if (open) return { meterId: open.id, found: true };
  const id = (await db.query<{ id: string }>(`select declare_meter($1, $2, $3, $4) id`, [participantId, meter.identifier, meter.scheme, meter.resource])).rows[0]!.id;
  return { meterId: id, found: false };
}

/**
 * What the prices of a bill need of its participant: a period, a time zone,
 * and the bill's currency as the currency of its country. Returns the time
 * zone. Refuses `participant_not_found`, `period_required`,
 * `time_zone_required`, `currency_mismatch`.
 */
async function placeOfBill(db: Db, participantId: string, reading: EnergyBillReading): Promise<string> {
  const place = (await db.query<{ time_zone: string | null; currency: string | null }>(
    `select time_zone, currency_of('participant', id) currency from participants where id = $1`, [participantId])).rows[0];
  if (!place) throw new Error(`participant_not_found: ${participantId}`);
  if (!reading.period) throw new Error('period_required: the bill says no period its prices hold from');
  if (!place.time_zone) throw new Error('time_zone_required: the prices of a bill hold from a local day of the participant');
  if (place.currency !== reading.invoice.currency) {
    throw new Error(`currency_mismatch: the bill is in ${reading.invoice.currency}, the participant's country counts in ${place.currency ?? 'no declared currency'}`);
  }
  return place.time_zone;
}

export interface BillAttribute {
  attribute: string;
  objectKind: 'participant' | 'meter';
  objectId: string;
  value: unknown;
}

const perMwh = (perKwh: number) => Math.round(perKwh * 1000 * 1000) / 1000;

/**
 * The supply contract as the bill prices it, from the first day of its
 * period: `supply_tariff` (the grid by band and season), `supply_energy_price`
 * (one price per MWh, the one the contract projects), `grid_fees_and_taxes`
 * (network delivery billed apart and the taxes per kWh, per MWh),
 * `supply_contract_type` on the participant; the subscribed power on the
 * meter (`subscribed_power` in kW, `subscribed_apparent_power` in kVA).
 * Status `published`, source the bill's document. Refuses `period_required`,
 * `time_zone_required` and `currency_mismatch` (the bill is not in the
 * currency of the participant's country).
 */
export async function tariffOfBill(
  db: Db,
  request: { participantId: string; meterId: string | null; reading: EnergyBillReading; documentId: string },
): Promise<BillAttribute[]> {
  const { participantId, meterId, reading, documentId } = request;
  const timeZone = await placeOfBill(db, participantId, reading);

  const written: BillAttribute[] = [];
  const set = async (objectKind: 'participant' | 'meter', objectId: string, attribute: string, value: unknown) => {
    await db.query(
      `select set_attribute($1, $2, $3, $4::jsonb, ($5::date)::timestamp at time zone $6, null, $7, 'published')`,
      [objectKind, objectId, attribute, JSON.stringify(value), reading.period!.start, timeZone, `documents:${documentId}`]);
    written.push({ attribute, objectKind, objectId, value });
  };

  await set('participant', participantId, 'supply_tariff', {
    currency: reading.invoice.currency,
    unit: 'per kWh',
    projection: reading.projection,
    revision: reading.revision,
    bands: reading.prices,
    hours: reading.bands,
    network: reading.network,
    taxes: reading.taxes,
    contributions: reading.contributions,
    subscription: reading.subscription,
    invoice: { number: reading.invoice.number, issue_date: reading.invoice.issueDate, period: reading.period },
  });
  const energy = meanProjectedPrice(reading);
  if (energy !== null) await set('participant', participantId, 'supply_energy_price', perMwh(energy));
  const network = reading.network.included === false ? reading.network.variablePerKwh : reading.network.included === true ? 0 : null;
  if (network !== null && (network > 0 || reading.taxes.perKwh !== null)) {
    await set('participant', participantId, 'grid_fees_and_taxes', perMwh(network + (reading.taxes.perKwh ?? 0)));
  }
  if (reading.contract) await set('participant', participantId, 'supply_contract_type', reading.contract.type);
  if (meterId && reading.power) {
    const attribute = reading.power.unitCode === 'KWT' ? 'subscribed_power' : reading.power.unitCode === 'KVA' ? 'subscribed_apparent_power' : null;
    if (attribute) await set('meter', meterId, attribute, reading.power.value);
  }
  return written;
}

/**
 * The three gestures of the core in their order: the bill attached, its
 * meter found or declared, its contract priced. What `tariffOfBill()`
 * refuses is checked first. Returns what was written.
 */
export async function importEnergyBill(
  db: Db,
  request: { participantId: string; reading: EnergyBillReading; file: BillFile },
): Promise<{ documentId: string; meterId: string | null; meterFound: boolean; attributes: BillAttribute[] }> {
  // Checked before anything is written: a bill refused writes nothing.
  await placeOfBill(db, request.participantId, request.reading);
  const documentId = await attachBill(db, request.participantId, request.reading, request.file);
  const meter = request.reading.meter ? await meterOfBill(db, request.participantId, request.reading) : null;
  const attributes = await tariffOfBill(db, { participantId: request.participantId, meterId: meter?.meterId ?? null, reading: request.reading, documentId });
  return { documentId, meterId: meter?.meterId ?? null, meterFound: meter?.found ?? false, attributes };
}
