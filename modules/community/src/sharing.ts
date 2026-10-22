// Energy sharing in a project, computed by an engine and recorded as a settlement.
//
// The module reads, it does not share: it gathers the participants of a
// project taking part over the period, the offtake and injection metered
// behind each one on one grid of steps, the allocation key the project
// holds as its attribute, what each participant carries for a key (its
// attributes) and the rules the caller passes (a country's pack, the
// project's statutes); it hands them to an engine of the `energy_sharing`
// kind (packages/core/src/connectors/sharing.ts) and stores what the engine
// answers — for each participant, what it received from the sharing and
// gave to it, and what is left for its supplier and the grid — as
// simulated series of the settlement, on the participant.
//
// Conventions: every stamp dates the start of its step, in UTC; energy in
// kWh per step. A participant with no series of a direction (a producer's
// offtake) sends zeros for it; one whose series misses steps of the period
// is refused by name, never filled.

import {
  ENGINE_CONTRACT,
  SHARING_INPUTS,
  SHARING_OUTPUTS,
  describeEngine,
  resample,
  runEngine,
  store,
  type Db,
  type EnergySharingRequest,
  type EnergySharingResult,
  type EngineSpec,
  type SharingParticipant,
} from '@nexgen-os/core';

export interface SettlementRequest {
  projectId: string;
  /** The period, `[from, to)`, as instants; `from` on the grid of `step`. */
  from: string;
  to: string;
  /** A Postgres interval: `15 minutes`, `1 hour`. */
  step: string;
  /** What a country's pack or the project sets, passed to the engine as it is. */
  rules?: Record<string, unknown>;
  engine: EngineSpec;
  /** A settlement this computation replaces: it keeps its id and takes the new inputs, provenance, results and series. */
  replaces?: string;
}

export interface SettlementResult {
  settlementId: string;
  /** What the engine said it is: the string the settlement records. */
  engine: string;
  sharedKwh: number;
  /** For each participant, the series of each output. */
  series: Record<string, Record<string, string>>;
}

interface KeyRow {
  value: { method?: unknown; parameters?: unknown };
  valid_from: string | null;
  valid_to: string | null;
  source: string | null;
  source_code: string | null;
  covers: boolean;
}

interface ParticipantRow {
  id: string;
  name: string;
  role: SharingParticipant['role'];
  attributes: Record<string, unknown>;
}

const iso = (at: string | Date) => new Date(at).toISOString().replace('.000Z', 'Z');

export async function settleSharing(db: Db, request: SettlementRequest): Promise<SettlementResult> {
  const project = (await db.query<{ id: string }>('select id from projects where id = $1', [request.projectId])).rows[0];
  if (!project) throw new Error(`project_not_found: ${request.projectId}`);

  const grid = (
    await db.query<{ at: Date; aligned: boolean }>(
      `select g at, date_bin($3::interval, $1::timestamptz, timestamptz '2000-01-01 00:00:00+00') = $1::timestamptz aligned
         from generate_series($1::timestamptz, $2::timestamptz - $3::interval, $3::interval) g`,
      [request.from, request.to, request.step],
    )
  ).rows.map((g) => ({ at: iso(g.at), aligned: g.aligned }));
  if (grid.length === 0) throw new Error(`period_empty: ${request.from} to ${request.to} holds no step of ${request.step}`);
  if (!grid[0].aligned) throw new Error(`period_misaligned: ${request.from} is not on the grid of ${request.step}`);
  const from = grid[0].at;
  const to = iso(request.to);

  // The key the project holds over the whole period: one value, no change inside.
  const keys = (
    await db.query<KeyRow>(
      `select value, valid_from, valid_to, source, source_code,
              (valid_from is null or valid_from <= $2::timestamptz) and (valid_to is null or valid_to >= $3::timestamptz) covers
         from attributes
        where object_id = $1 and attribute_type = 'allocation_key'
          and (valid_from is null or valid_from < $3::timestamptz) and (valid_to is null or valid_to > $2::timestamptz)
        order by valid_from nulls first`,
      [request.projectId, from, to],
    )
  ).rows;
  if (keys.length === 0) throw new Error(`key_required: the project has no allocation_key from ${from} to ${to}`);
  if (keys.length > 1) throw new Error(`key_changes_in_period: the project's allocation_key changes between ${from} and ${to}; share each period apart`);
  const key = keys[0];
  if (!key.covers) throw new Error(`key_outside_period: the project's allocation_key holds from ${key.valid_from ? iso(key.valid_from) : 'ever'} to ${key.valid_to ? iso(key.valid_to) : 'ever'}`);
  if (typeof key.value?.method !== 'string') throw new Error('key_invalid: an allocation_key is {"method": "...", "parameters": {...}}');
  const parameters = (key.value.parameters ?? {}) as Record<string, unknown>;

  // Where the pack (or the project, the organisation) says a consent to
  // sharing is required, a participant without one over the whole period is refused.
  const unconsented = (
    await db.query<{ name: string }>(
      `select m.name from community.consents_missing($1, 'sharing', $2::timestamptz, $3::timestamptz) m
        where community.parameter_if_decided('participant', m.participant_id, 'sharing_consent_required', $2::timestamptz)->'value' = 'true'::jsonb`,
      [request.projectId, from, to],
    )
  ).rows;
  if (unconsented.length > 0) {
    throw new Error(`consent_missing: ${unconsented.map((u) => u.name).join(', ')} hold no consent to sharing from ${from} to ${to}, which the rules of their place require`);
  }

  const described = await describeEngine(request.engine);
  if (!described.kinds.includes('energy_sharing')) {
    throw new Error(`engine_kind_unsupported: ${request.engine.name} accepts ${described.kinds.join(', ')}, not energy_sharing`);
  }

  // The participants taking part over the period, groups left out: a group carries no meter of its own.
  const participants = (
    await db.query<ParticipantRow>(
      `select p.id, p.name, p.role, attributes_of(p.id, $2::timestamptz) attributes
         from participants p
        where p.project_id = $1 and p.country is not null
          and (p.join_date is null or p.join_date < $3::timestamptz) and (p.leave_date is null or p.leave_date >= $2::timestamptz)
        order by p.name, p.id`,
      [request.projectId, from, to],
    )
  ).rows;
  if (participants.length === 0) throw new Error(`participants_missing: the project has no participant taking part from ${from} to ${to}`);


  // The curves of the modules that hold them, when installed: what a
  // participant with no metered series of its own is read from.
  const curves = (
    await db.query<{ production: boolean; consumption: boolean }>(
      `select to_regprocedure('solar.curve(uuid, timestamptz, timestamptz, interval)') is not null production,
              to_regprocedure('consumption.curve(uuid, timestamptz, timestamptz, interval)') is not null consumption`,
    )
  ).rows[0];

  const sent: SharingParticipant[] = [];
  const read: Record<string, Record<string, unknown>> = {};
  for (const p of participants) {
    const metered: Record<string, Map<number, number>> = {};
    const ids: Record<string, string[]> = {};
    for (const quantity of SHARING_INPUTS) {
      ids[quantity] = (
        await db.query<{ id: string }>(
          `select id from series
            where quantity_code = $2 and kind = 'measured'
              and (object_id = $1 or object_id in (select meter_id from participant_meters($1)))
            order by id`,
          [p.id, quantity],
        )
      ).rows.map((r) => r.id);
      const sum = new Map<number, number>();
      for (const id of ids[quantity]) {
        for (const b of await resample(db, id, from, to, request.step)) {
          if (b.value === null || b.samples === 0) continue;
          const at = Date.parse(b.bucket);
          sum.set(at, (sum.get(at) ?? 0) + Number(b.value));
        }
      }
      const missing = ids[quantity].length === 0 ? 0 : grid.filter((g) => !sum.has(Date.parse(g.at))).length;
      if (missing > 0) throw new Error(`series_incomplete: ${quantity} of ${p.name} misses ${missing} of ${grid.length} steps from ${from} to ${to}`);
      metered[quantity] = sum;
    }
    read[p.id] = { ...ids };

    // No meter read: the participant's production (measured first) and
    // consumption curves, netted step by step — what it consumes of its own
    // production is min(production, consumption), never more.
    if (SHARING_INPUTS.every((q) => ids[q].length === 0) && (curves.production || curves.consumption)) {
      const curve = async (sql: string) => {
        const rows = (await db.query<{ bucket: string | Date; value: number | null; series: unknown }>(sql, [p.id, from, to, request.step])).rows;
        return { values: new Map(rows.filter((r) => r.value !== null).map((r) => [Date.parse(iso(r.bucket)), Number(r.value)])), series: rows[0]?.series ?? null };
      };
      const production = curves.production ? await curve('select bucket, value, series from solar.curve($1, $2, $3, $4::interval)') : null;
      const consumption = curves.consumption
        ? await curve(`select bucket, value, jsonb_build_object(series_id, kind) series from consumption.curve($1, $2, $3, $4::interval)`)
        : null;
      if ((production?.values.size ?? 0) + (consumption?.values.size ?? 0) > 0) {
        const off = new Map<number, number>();
        const inj = new Map<number, number>();
        for (const g of grid) {
          const at = Date.parse(g.at);
          const prod = production?.values.get(at) ?? 0;
          const cons = consumption?.values.get(at) ?? 0;
          const self = Math.min(prod, cons);
          off.set(at, cons - self);
          inj.set(at, prod - self);
        }
        metered.offtake_energy = off;
        metered.injection_energy = inj;
        read[p.id] = { ...ids, curves: { production: production?.series ?? null, consumption: consumption?.series ?? null, netted: 'offtake = consumption − min(production, consumption), injection = production − min(production, consumption)' } };
      }
    }
    sent.push({
      id: p.id, name: p.name, role: p.role, attributes: p.attributes,
      series: SHARING_INPUTS.map((quantity) => ({
        quantity_code: quantity, value_kind: 'interval' as const, step: request.step, unit: 'kWh',
        values: grid.map((g) => ({ at: g.at, value: metered[quantity].get(Date.parse(g.at)) ?? 0 })),
      })),
    });
  }

  const inputs = {
    engine: { name: request.engine.name, version: described.version, contract: ENGINE_CONTRACT, dependencies: described.dependencies },
    key: { method: key.value.method, parameters, valid_from: key.valid_from && iso(key.valid_from), valid_to: key.valid_to && iso(key.valid_to), source: key.source, source_code: key.source_code },
    rules: request.rules ?? {},
    period: { from, to, step: request.step },
    participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role, attributes: p.attributes, series: read[p.id] })),
    conventions: { time: 'interval start, UTC', energy: 'kWh per step', missing_direction: 'zeros' },
  };

  const engineRequest: EnergySharingRequest = {
    kind: 'energy_sharing', from, to, step: request.step, participants: sent,
    key: { method: key.value.method, parameters }, rules: request.rules ?? {},
  };
  const answer = await runEngine<EnergySharingRequest, EnergySharingResult>(request.engine, engineRequest);
  if (answer.version !== described.version) throw new Error(`engine_contract_mismatch: ${request.engine.name} described itself as ${described.version} and answered as ${answer.version}`);

  // What was shared cannot exceed what crossed the meters: at every step a
  // participant receives at most its offtake and gives at most its
  // injection, and the project shares no more than it injected nor more than
  // it took — the energy received is energy given.
  assertPhysical(sent, answer.result, grid.map((g) => g.at), request.engine.name);

  // The settlement is written, or the one it replaces takes the new inputs;
  // the answer is stored as it comes, once checked against the request.
  const settlementId = await writeSettlement(db, request, described.version, inputs);
  const stored: Record<string, Record<string, string>> = {};
  for (const p of participants) {
    const answered = answer.result.participants?.find((r) => r.id === p.id);
    if (!answered) throw new Error(`engine_contract_mismatch: ${request.engine.name} answered nothing for participant ${p.name}`);
    stored[p.id] = {};
    for (const quantity of SHARING_OUTPUTS) {
      const s = answered.series.find((x) => x.quantity_code === quantity);
      if (!s || s.values.length !== grid.length || s.values.some((v, i) => Date.parse(v.at) !== Date.parse(grid[i].at))) {
        throw new Error(`engine_contract_mismatch: ${request.engine.name} answered no ${quantity} on the grid for participant ${p.name}`);
      }
      const { seriesId } = await store(db, {
        object_kind: 'participant', object_id: p.id, quantity_code: quantity, kind: 'simulated', value_kind: 'interval', step: request.step, source: `community.settlements:${settlementId}`,
      }, s.values, { unit: s.unit ?? null });
      stored[p.id][quantity] = seriesId;
    }
  }

  const results = {
    totals: answer.result.totals,
    meta: answer.result.meta,
    participants: participants.map((p) => ({ id: p.id, totals: answer.result.participants.find((r) => r.id === p.id)!.totals, series: stored[p.id] })),
  };
  await db.query('update community.settlements set results = $2::jsonb where id = $1', [settlementId, JSON.stringify(results)]);
  return { settlementId, engine: answer.version, sharedKwh: Number(answer.result.totals?.shared_energy ?? 0), series: stored };
}

// An engine writes its values to the micro-kWh: each one may be off by its
// rounding, and a sum of n of them by n roundings.
const TOLERANCE_KWH = 1e-6;

/**
 * The physical caps of a sharing, checked on an engine's answer before
 * anything is stored: per participant and step, what it received is at most
 * its offtake and what it gave at most its injection; per step, what all
 * received is at most what all gave, and at most the smaller of the total
 * injection and the total offtake. Refuses `settlement_exceeds_physics`.
 */
export function assertPhysical(sent: SharingParticipant[], result: EnergySharingResult, steps: string[], engine: string): void {
  const valueAt = (series: { quantity_code: string; values: { at: string; value: number }[] }[] | undefined, quantity: string, i: number) =>
    Number(series?.find((x) => x.quantity_code === quantity)?.values[i]?.value ?? 0);
  for (let i = 0; i < steps.length; i += 1) {
    let received = 0;
    let given = 0;
    let injected = 0;
    let taken = 0;
    for (const p of sent) {
      const answered = result.participants?.find((r) => r.id === p.id)?.series;
      const r = valueAt(answered, 'shared_offtake_energy', i);
      const g = valueAt(answered, 'shared_injection_energy', i);
      const off = valueAt(p.series, 'offtake_energy', i);
      const inj = valueAt(p.series, 'injection_energy', i);
      if (r < -TOLERANCE_KWH || g < -TOLERANCE_KWH) {
        throw new Error(`settlement_exceeds_physics: ${engine} shares a negative energy with ${p.name} at ${steps[i]}`);
      }
      if (r > off + TOLERANCE_KWH) {
        throw new Error(`settlement_exceeds_physics: ${p.name} receives ${r} kWh at ${steps[i]} and took ${off} kWh from the grid`);
      }
      if (g > inj + TOLERANCE_KWH) {
        throw new Error(`settlement_exceeds_physics: ${p.name} gives ${g} kWh at ${steps[i]} and injected ${inj} kWh`);
      }
      received += r;
      given += g;
      injected += inj;
      taken += off;
    }
    const summed = TOLERANCE_KWH * Math.max(1, sent.length);
    if (received > given + summed) {
      throw new Error(`settlement_exceeds_physics: ${received} kWh received and ${given} kWh given at ${steps[i]}`);
    }
    if (received > Math.min(injected, taken) + summed) {
      throw new Error(`settlement_exceeds_physics: ${received} kWh shared at ${steps[i]}, more than min(${injected} injected, ${taken} taken)`);
    }
  }
}

/**
 * A new row of `community.settlements` with its inputs and provenance, or the
 * one the request replaces with the new ones, its series removed to be
 * written again. Its results follow once the series are stored.
 */
async function writeSettlement(db: Db, request: SettlementRequest, provenance: string, inputs: unknown): Promise<string> {
  const row = request.replaces
    ? (await db.query<{ id: string }>(
        'update community.settlements set project_id = $2, provenance = $3, inputs = $4::jsonb where id = $1 returning id',
        [request.replaces, request.projectId, provenance, JSON.stringify(inputs)])).rows[0]
    : (await db.query<{ id: string }>(
        `insert into community.settlements (organisation_id, project_id, provenance, inputs, results)
         values (object_organisation('project', $1), $1, $2, $3::jsonb, '{}') returning id`,
        [request.projectId, provenance, JSON.stringify(inputs)])).rows[0];
  if (!row) throw new Error(`settlement_not_found: ${request.replaces}`);
  if (request.replaces) await db.query('delete from series where source = $1', [`community.settlements:${row.id}`]);
  return row.id;
}
