// The consumption of a participant over the period of a bill: the energy
// `@nexgen-os/energy-bill` read on it, spread by a load profile through the
// estimate of `curve.ts`, kept in `consumption.estimates` with the bill it names.

import type { EnergyBillReading } from '@nexgen-os/energy-bill';
import type { Db } from '@nexgen-os/core';
import { estimateConsumption, type EstimateResult } from './curve.js';

/** The local day after `day`, `YYYY-MM-DD`. */
function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Estimates the curve of a participant over the consumption period of a
 * bill (its last day included) from the kWh the bill bills, each counted
 * once. Refuses `credit_note_not_consumption`, `period_required`,
 * `energy_required`, and what `estimateConsumption()` refuses.
 */
export async function estimateFromBill(
  db: Db,
  request: { participantId: string; reading: EnergyBillReading; profileCode: string; documentId?: string | null; replaces?: string },
): Promise<EstimateResult> {
  const { reading } = request;
  if (reading.invoice.kind === 'credit_note') throw new Error(`credit_note_not_consumption: ${reading.invoice.number} gives money back and bills no energy`);
  if (!reading.period) throw new Error('period_required: the bill says no consumption period');
  if (reading.energy.kwh === null) throw new Error('energy_required: the bill says no energy over its period');
  return estimateConsumption(db, {
    participantId: request.participantId,
    from: reading.period.start,
    to: dayAfter(reading.period.end),
    profileCode: request.profileCode,
    energy: {
      kwh: reading.energy.kwh,
      source: `invoice ${reading.invoice.number} of ${reading.invoice.issueDate}`,
      documentId: request.documentId ?? null,
    },
    ...(request.replaces ? { replaces: request.replaces } : {}),
  });
}
