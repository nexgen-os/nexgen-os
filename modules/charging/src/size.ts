// size() — the charge points of a participant or a project: how many, and
// at which power, by a named criterion of `sizing_criteria` (decision
// 0045), recorded as an estimate in `charging.estimates`.
//
// What it reads is data, said in its inputs: the vehicles of a typical day
// (when each arrives and leaves, the energy it asks for), the powers of
// charge point the person considers, and the power of the connection —
// stated in the bounds, or the subscribed power of the meters of the
// subject. Each candidate (a number of points at one power) is run over
// three days of the same pattern at a step of 15 minutes, and the second
// day is measured, so that a vehicle staying overnight is counted once:
//
//   a vehicle that arrives takes a free point, first come first served, or
//   is refused when every point is taken; it holds its point until it
//   leaves, and charges at the power of the point until it has what it
//   asked for; when the points together would draw more than the
//   connection leaves (its power less the base load), every charging
//   vehicle is slowed in the same proportion, as a load management does.
//
// The criteria it recommends for:
//
//   demand_served  the smallest installed power (then the fewest points)
//                  that delivers at least the target share of the energy
//                  asked before the vehicles leave;
//   max_power      the largest installed power the connection allows
//                  without slowing any vehicle (points × power within what
//                  the connection leaves), the most demand served among
//                  equals.

import type { Db } from '@nexgen-os/core';

export const CHARGING_ENGINE_VERSION = 'charging-size-0.3.0';
export const RECOMMENDED_FOR = ['demand_served', 'max_power'] as const;
export type Criterion = (typeof RECOMMENDED_FOR)[number];

/** Vehicles of a typical day that arrive and leave at the same times and ask for the same energy. */
export interface Vehicles {
  /** Local time of the place, `HH:MM`. A departure at or before the arrival is the next day. */
  arrival: string;
  departure: string;
  energyKwh: number;
  count?: number;
}

export interface SizeRequest {
  subject: { kind: 'participant' | 'project'; id: string };
  criterion: Criterion;
  /** For `demand_served`: the share of the energy asked to deliver, 0 to 1. */
  target?: number;
  vehicles: Vehicles[];
  bounds: {
    /** The powers of a charge point to consider, kW. */
    powersKw: number[];
    /** The most points to consider; the number of vehicles of the day when absent. */
    maxPoints?: number;
    /** The power of the connection, kW; the subscribed power of the meters of the subject when absent. */
    connectionKw?: number;
    /** What the other loads of the place take at most, kW, kept from the connection; 0 when absent. */
    baseLoadKw?: number;
  };
}

export interface SizePoint {
  points: number;
  power_kw: number;
  installed_kw: number;
  demand_served: number;
  vehicles_refused: number;
  peak_kw: number;
}

export interface SizeResult {
  estimateId: string;
  curve: SizePoint[];
  recommended: SizePoint | null;
  reason: string | null;
}

const STEP_MINUTES = 15;
const DAY = 1440;

function minutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`vehicles_invalid: ${hhmm} is not a time HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** One candidate run over three days of the pattern; the vehicles arriving on the second day are measured. */
export function simulate(vehicles: Vehicles[], points: number, powerKw: number, availableKw: number): Omit<SizePoint, 'points' | 'power_kw' | 'installed_kw'> {
  interface Car { arrive: number; leave: number; asked: number; left: number; measured: boolean; point: boolean; refused: boolean }
  const cars: Car[] = [];
  for (let day = 0; day < 3; day++) {
    for (const v of vehicles) {
      const a = minutes(v.arrival);
      let d = minutes(v.departure);
      if (d <= a) d += DAY;
      for (let i = 0; i < (v.count ?? 1); i++) {
        cars.push({ arrive: day * DAY + a, leave: day * DAY + d, asked: v.energyKwh, left: v.energyKwh, measured: day === 1, point: false, refused: false });
      }
    }
  }
  cars.sort((x, y) => x.arrive - y.arrive);
  const h = STEP_MINUTES / 60;
  let peak = 0;
  for (let t = 0; t < 4 * DAY; t += STEP_MINUTES) {
    for (const c of cars) if (c.point && c.leave <= t) c.point = false;
    let used = cars.filter((c) => c.point).length;
    for (const c of cars) {
      if (c.arrive <= t && c.arrive > t - STEP_MINUTES && !c.point && !c.refused && c.leave > t) {
        if (used < points) {
          c.point = true;
          used++;
        } else c.refused = true;
      }
    }
    const charging = cars.filter((c) => c.point && c.left > 1e-9);
    const wanted = charging.map((c) => Math.min(powerKw, c.left / h));
    const total = wanted.reduce((s, w) => s + w, 0);
    const scale = total > availableKw ? availableKw / total : 1;
    charging.forEach((c, i) => {
      c.left -= wanted[i] * scale * h;
    });
    if (t >= DAY && t < 2 * DAY) peak = Math.max(peak, total * scale);
  }
  const measured = cars.filter((c) => c.measured);
  const asked = measured.reduce((s, c) => s + c.asked, 0);
  const delivered = measured.reduce((s, c) => s + (c.asked - Math.max(c.left, 0)), 0);
  return {
    demand_served: asked > 0 ? Math.round((delivered / asked) * 1e4) / 1e4 : 1,
    vehicles_refused: measured.filter((c) => c.refused).length,
    peak_kw: Math.round(peak * 1e3) / 1e3,
  };
}

/** The power of the connection: stated, or the subscribed power of the meters of the subject, with where it came from. */
async function connectionOf(db: Db, request: SizeRequest): Promise<{ kw: number; from: unknown }> {
  if (request.bounds.connectionKw !== undefined) return { kw: request.bounds.connectionKw, from: { level: 'request' } };
  const meters = (await db.query<{ id: string }>(
    request.subject.kind === 'participant'
      ? 'select id from meters where participant_id = $1 order by id'
      : 'select m.id from meters m join participants p on p.id = m.participant_id where p.project_id = $1 order by m.id',
    [request.subject.id])).rows;
  let kw = 0;
  const from: unknown[] = [];
  for (const m of meters) {
    const value = (await db.query<{ v: unknown }>(`select attributes_of($1)->'subscribed_power' v`, [m.id])).rows[0].v;
    if (value === null || value === undefined) continue;
    kw += Number(value);
    from.push({ meter_id: m.id, attribute: 'subscribed_power', value: Number(value) });
  }
  if (!from.length) throw new Error('connection_power_required: no meter of the subject has a subscribed_power, and the bounds do not state connectionKw');
  return { kw, from };
}

/** Sizes the charge points of a participant or a project by a named criterion; records the estimate. */
export async function size(db: Db, request: SizeRequest): Promise<SizeResult> {
  const known = (await db.query<{ code: string }>('select code from sizing_criteria where code = $1', [request.criterion])).rows[0];
  if (!known) throw new Error(`sizing_criterion_unknown: ${String(request.criterion)} is not a sizing_criteria code`);
  if (!RECOMMENDED_FOR.includes(request.criterion)) {
    throw new Error(`criterion_unsupported: charge points are sized for ${RECOMMENDED_FOR.join(', ')}, not ${String(request.criterion)}`);
  }
  if (request.criterion === 'demand_served' && !(request.target !== undefined && request.target > 0 && request.target <= 1)) {
    throw new Error('target_required: demand_served is aimed at a target share between 0 and 1, which the person states');
  }
  if (!request.vehicles?.length) throw new Error('vehicles_required: the arrivals and departures of the vehicles are the data a sizing reads');
  for (const v of request.vehicles) {
    minutes(v.arrival);
    minutes(v.departure);
    if (!(v.energyKwh >= 0) || (v.count !== undefined && !(Number.isInteger(v.count) && v.count > 0))) {
      throw new Error('vehicles_invalid: each vehicle asks for 0 kWh or more, and a count is a whole number above 0');
    }
  }
  const powers = request.bounds?.powersKw ?? [];
  if (!powers.length || powers.some((p) => !(p > 0))) throw new Error('bounds_required: the powers of a charge point to consider, each above 0 kW');
  const exists = (await db.query(`select 1 from ${request.subject.kind === 'participant' ? 'participants' : 'projects'} where id = $1`, [request.subject.id])).rows.length;
  if (!exists) throw new Error(`${request.subject.kind}_not_found: ${request.subject.id}`);

  const vehicleCount = request.vehicles.reduce((s, v) => s + (v.count ?? 1), 0);
  const maxPoints = request.bounds.maxPoints ?? vehicleCount;
  const connection = await connectionOf(db, request);
  const baseLoad = request.bounds.baseLoadKw ?? 0;
  const available = connection.kw - baseLoad;
  if (!(available > 0)) throw new Error(`connection_exhausted: the connection (${connection.kw} kW) leaves nothing beside the base load (${baseLoad} kW)`);

  const curve: SizePoint[] = [];
  for (const power of [...powers].sort((a, b) => a - b)) {
    for (let n = 1; n <= maxPoints; n++) {
      curve.push({ points: n, power_kw: power, installed_kw: Math.round(n * power * 1e3) / 1e3, ...simulate(request.vehicles, n, power, available) });
    }
  }

  let recommended: SizePoint | null = null;
  let reason: string | null = null;
  if (request.criterion === 'demand_served') {
    const meeting = curve.filter((p) => p.demand_served >= request.target! - 1e-9);
    recommended = meeting.reduce<SizePoint | null>((b, p) => (!b || p.installed_kw < b.installed_kw || (p.installed_kw === b.installed_kw && p.points < b.points) ? p : b), null);
    if (!recommended) reason = `target_not_reached: no candidate delivers ${request.target} of the energy asked within the connection`;
  } else {
    const within = curve.filter((p) => p.installed_kw <= available + 1e-9);
    recommended = within.reduce<SizePoint | null>((b, p) => (!b || p.installed_kw > b.installed_kw || (p.installed_kw === b.installed_kw && p.demand_served > b.demand_served) ? p : b), null);
    if (!recommended) reason = `connection_too_small: no point of ${Math.min(...powers)} kW fits within the ${available} kW the connection leaves`;
  }

  const inputs = {
    subject: request.subject,
    vehicles: request.vehicles,
    step_minutes: STEP_MINUTES,
    bounds: { powers_kw: powers, max_points: maxPoints },
    connection_kw: connection.kw,
    connection_from: connection.from,
    base_load_kw: baseLoad,
    target: request.target ?? null,
  };
  const results = { criterion: request.criterion, recommended, reason, curve };
  const row = (await db.query<{ id: string }>(
    `insert into charging.estimates (participant_id, project_id, criterion, provenance, inputs, results)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb) returning id`,
    [request.subject.kind === 'participant' ? request.subject.id : null, request.subject.kind === 'project' ? request.subject.id : null,
     request.criterion, CHARGING_ENGINE_VERSION, JSON.stringify(inputs), JSON.stringify(results)])).rows[0];
  return { estimateId: row.id, curve, recommended, reason };
}
