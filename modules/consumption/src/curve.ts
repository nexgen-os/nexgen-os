// The consumption curve of a participant, estimated: an energy spread over its
// period by a load profile, recorded as an estimate.
//
// A bill says how much a participant consumed between two dates; an annual
// consumption says how much in a year. Neither says when. A load profile
// says how energy spreads over the slots of a day, the day types of a week
// and the months of a year — by shapes given as data, or by the participant's
// activity hours — and the estimate gives each slot of the period its
// share of the energy:
//
//   1. weigh   each slot of the period, cut in the participant's local days: the
//              shape of its day type (weekday, saturday, sunday) at its
//              local time, or 1 while the participant is open and the profile's
//              `closed_ratio` while it is closed, pro rata of the part of
//              the slot that is open; then the factor of its local month;
//   2. spread  the energy over the slots in proportion to their weights,
//              so that the curve adds up to the energy of the period.
//
// Conventions: every value is the energy of its slot, in kWh, dated at the
// start of the slot, in UTC. Days are the participant's local days, daylight-saving
// time included, since a timetable is read on the wall clock: the spring
// day has one hour less, its missing hour weighs nothing, and the autumn
// day one more, its repeated hour weighed twice. Public holidays are not
// known here and weigh as the day of the week they fall on.

import { offsetAt, store, type Db, type SeriesPoint } from '@nexgen-os/core';

export const CONSUMPTION_ENGINE_VERSION = 'consumption-curve-0.3.0';

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

export type DayType = 'weekday' | 'saturday' | 'sunday';

/** A load profile as `consumption.load_profiles` holds it. */
export interface LoadProfile {
  code: string;
  method: 'day_shapes' | 'activity_hours';
  slots_per_day: number;
  day_shapes: Partial<Record<DayType, number[]>> | null;
  closed_ratio: number | null;
  monthly_factors: number[] | null;
  source_code: string | null;
}

/** Hours a participant is open on a day of the week, local wall clock (`08:00`, `24:00`), over a period of dates, the end excluded. */
export interface OpeningHours {
  /** ISO day of the week, 1 Monday to 7 Sunday. */
  weekday: number;
  opens: string;
  closes: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface WeightedSlot {
  at: string;
  weight: number;
}

/** A local date, `YYYY-MM-DD`, as days since 1970-01-01. */
function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`date_invalid: ${date} is not a YYYY-MM-DD date`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`date_invalid: ${date} is not a calendar date`);
  return ms / (DAY_MINUTES * MINUTE_MS);
}

/** The instant a local day starts in a time zone. */
function localMidnight(day: number, timeZone: string): number {
  const wall = day * DAY_MINUTES * MINUTE_MS;
  const first = wall - offsetAt(timeZone, wall) * MINUTE_MS;
  return wall - offsetAt(timeZone, first) * MINUTE_MS;
}

/** Minutes of a wall-clock time, `24:00` being the end of the day. */
function minutesOf(time: string): number {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!m) throw new Error(`time_invalid: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60;
}

function dayType(isoWeekday: number): DayType {
  return isoWeekday === 6 ? 'saturday' : isoWeekday === 7 ? 'sunday' : 'weekday';
}

/**
 * The slots of the local days `from` to `to` (excluded) of a time zone,
 * each with its weight under a profile. A profile by activity hours reads
 * `hours`; one by day shapes ignores them.
 */
export function slotWeights(profile: LoadProfile, from: string, to: string, timeZone: string, hours: OpeningHours[] = []): WeightedSlot[] {
  if (!timeZone) throw new Error('time_zone_required: a consumption curve is cut in the participant\'s local days');
  const first = dayNumber(from);
  const last = dayNumber(to);
  if (!(last > first)) throw new Error(`period_empty: ${from} to ${to}`);
  if (DAY_MINUTES % profile.slots_per_day !== 0) throw new Error(`slots_invalid: ${profile.slots_per_day} slots do not divide a day`);
  if (profile.monthly_factors && profile.monthly_factors.length !== 12) throw new Error(`monthly_factors_invalid: ${profile.code} needs 12 factors`);
  if (profile.method === 'activity_hours' && profile.closed_ratio === null) throw new Error(`closed_ratio_required: ${profile.code}`);
  const slot = DAY_MINUTES / profile.slots_per_day;
  const closed = profile.closed_ratio ?? 0;
  const windows = hours.map((h) => ({
    weekday: h.weekday,
    opens: minutesOf(h.opens),
    closes: minutesOf(h.closes),
    from: h.valid_from === null ? -Infinity : dayNumber(h.valid_from),
    to: h.valid_to === null ? Infinity : dayNumber(h.valid_to),
  }));

  const slots: WeightedSlot[] = [];
  let start = localMidnight(first, timeZone);
  for (let day = first; day < last; day++) {
    const end = localMidnight(day + 1, timeZone);
    const date = new Date(day * DAY_MINUTES * MINUTE_MS);
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    const month = profile.monthly_factors ? profile.monthly_factors[date.getUTCMonth()] : 1;
    const shape = profile.method === 'day_shapes' ? profile.day_shapes?.[dayType(weekday)] : undefined;
    const open = windows.filter((w) => w.weekday === weekday && w.from <= day && day < w.to);
    for (let t = start; t < end; t += slot * MINUTE_MS) {
      // The wall clock of the slot: the autumn's repeated hour reads twice, the spring's missing hour never.
      const wall = Math.round((t + offsetAt(timeZone, t) * MINUTE_MS) / MINUTE_MS) - day * DAY_MINUTES;
      let weight: number;
      if (profile.method === 'day_shapes') {
        weight = shape ? shape[Math.min(Math.floor(wall / slot), profile.slots_per_day - 1)] : 0;
      } else {
        const openMinutes = open.reduce((sum, w) => sum + Math.max(0, Math.min(wall + slot, w.closes) - Math.max(wall, w.opens)), 0);
        weight = closed + (1 - closed) * Math.min(1, openMinutes / slot);
      }
      slots.push({ at: new Date(t).toISOString(), weight: weight * month });
    }
    start = end;
  }
  return slots;
}

/** An energy spread over weighted slots in proportion to their weights: the curve adds up to the energy. */
export function spreadEnergy(kwh: number, slots: WeightedSlot[]): SeriesPoint[] {
  if (!(Number.isFinite(kwh) && kwh >= 0)) throw new Error(`energy_invalid: ${kwh}`);
  const total = slots.reduce((sum, s) => sum + s.weight, 0);
  if (!(total > 0)) throw new Error('profile_without_weight: no slot of the period weighs anything under this profile');
  return slots.map((s) => ({ at: s.at, value: round((kwh * s.weight) / total) }));
}

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

export interface EstimateRequest {
  participantId: string;
  /** First local day of the period, `YYYY-MM-DD`. */
  from: string;
  /** Local day after the last, `YYYY-MM-DD`. */
  to: string;
  profileCode: string;
  /**
   * The energy of the period: a bill, with where it comes from. Without
   * it, the participant's `annual_consumption` attribute on the first day, and the
   * period must then be one year.
   */
  energy?: { kwh: number; sourceCode?: string | null; source?: string | null; documentId?: string | null };
  /** An estimate this computation replaces: it keeps its id and takes the new inputs, provenance, results and series. */
  replaces?: string;
}

export interface EstimateResult {
  estimateId: string;
  seriesId: string;
  kwh: number;
  step: string;
  slots: number;
}

export async function estimateConsumption(db: Db, request: EstimateRequest): Promise<EstimateResult> {
  const place = (await db.query<{ time_zone: string | null }>('select time_zone from participants where id = $1', [request.participantId])).rows[0];
  if (!place) throw new Error(`participant_not_found: ${request.participantId}`);
  if (!place.time_zone) throw new Error('time_zone_required: the participant has no time zone; a consumption curve is cut in its local days');
  const profile = (
    await db.query<LoadProfile>(
      `select code, method, slots_per_day, day_shapes, closed_ratio, monthly_factors, source_code
         from consumption.load_profiles where code = $1`,
      [request.profileCode],
    )
  ).rows[0];
  if (!profile) throw new Error(`load_profile_unknown: ${request.profileCode}`);

  let hours: OpeningHours[] = [];
  if (profile.method === 'activity_hours') {
    hours = (
      await db.query<OpeningHours>(
        `select weekday, opens::text opens, closes::text closes, valid_from::text valid_from, valid_to::text valid_to
           from consumption.activity_hours
          where object_id = $1
            and (valid_from is null or valid_from < $3::date) and (valid_to is null or valid_to > $2::date)
          order by weekday, opens, closes, valid_from nulls first`,
        [request.participantId, request.from, request.to],
      )
    ).rows;
    if (hours.length === 0) throw new Error(`activity_hours_required: ${profile.code} spreads energy by activity hours and the participant has none over ${request.from} to ${request.to}`);
  }

  const energy = request.energy ?? (await annualConsumption(db, request, place.time_zone));
  const values = spreadEnergy(energy.kwh, slotWeights(profile, request.from, request.to, place.time_zone, hours));
  const step = `${DAY_MINUTES / profile.slots_per_day} minutes`;

  const inputs = {
    period: { from: request.from, to: request.to, time_zone: place.time_zone },
    energy: { kwh: energy.kwh, source_code: energy.sourceCode ?? null, source: energy.source ?? null, document_id: energy.documentId ?? null },
    profile,
    activity_hours: hours,
    conventions: { time: 'interval start, UTC', energy: 'kWh per slot', days: 'local days of the participant, daylight-saving time included', holidays: 'not modelled' },
  };

  // A new estimate, or the one the request replaces with the new inputs, its
  // series removed to be written again; its results follow the series.
  const row = request.replaces
    ? (await db.query<{ id: string }>(
        'update consumption.estimates set participant_id = $2, provenance = $3, inputs = $4::jsonb where id = $1 returning id',
        [request.replaces, request.participantId, CONSUMPTION_ENGINE_VERSION, JSON.stringify(inputs)])).rows[0]
    : (await db.query<{ id: string }>(
        `insert into consumption.estimates (organisation_id, participant_id, provenance, inputs, results)
         values (object_organisation('participant', $1), $1, $2, $3::jsonb, '{}') returning id`,
        [request.participantId, CONSUMPTION_ENGINE_VERSION, JSON.stringify(inputs)])).rows[0];
  if (!row) throw new Error(`estimate_not_found: ${request.replaces}`);
  if (request.replaces) await db.query('delete from series where source = $1', [`consumption.estimates:${row.id}`]);
  const { seriesId } = await store(db, {
    object_kind: 'participant', object_id: request.participantId, quantity_code: 'consumption_energy', kind: 'simulated', value_kind: 'interval', step,
    source_code: energy.sourceCode ?? null, name: `${profile.code} ${request.from} to ${request.to}`, source: `consumption.estimates:${row.id}`,
  }, values);
  const kwh = round(values.reduce((sum, v) => sum + v.value, 0));
  const results = { series_id: seriesId, kwh, step, slots: values.length };
  await db.query('update consumption.estimates set results = $2::jsonb where id = $1', [row.id, JSON.stringify(results)]);
  return { estimateId: row.id, seriesId, kwh, step, slots: values.length };
}

/** The participant's annual consumption at the start of the first local day, for a period of one year. */
async function annualConsumption(db: Db, request: EstimateRequest, timeZone: string): Promise<NonNullable<EstimateRequest['energy']>> {
  const first = new Date(dayNumber(request.from) * DAY_MINUTES * MINUTE_MS);
  const yearLater = new Date(Date.UTC(first.getUTCFullYear() + 1, first.getUTCMonth(), first.getUTCDate())).toISOString().slice(0, 10);
  if (request.to !== yearLater) {
    throw new Error(`energy_required: ${request.from} to ${request.to} is not one year; give the energy of the period`);
  }
  const row = (
    await db.query<{ kwh: string | null }>(`select attributes_of($1, ($2::date)::timestamp at time zone $3) ->> 'annual_consumption' kwh`, [request.participantId, request.from, timeZone])
  ).rows[0];
  if (row?.kwh === null || row?.kwh === undefined) {
    throw new Error('energy_required: the participant has no annual_consumption on the first day of the period; give the energy of the period');
  }
  return { kwh: Number(row.kwh), sourceCode: null, source: 'annual_consumption of the participant' };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
