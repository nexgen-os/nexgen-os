// Energy sharing in a project, computed by an engine and recorded as a run.
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
// simulated series of the run, on the participant.
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

export interface SharingRunRequest {
  projectId: string;
  /** The period, `[from, to)`, as instants; `from` on the grid of `step`. */
  from: string;
  to: string;
  /** A Postgres interval: `15 minutes`, `1 hour`. */
  step: string;
  /** What a country's pack or the project sets, passed to the engine as it is. */
  rules?: Record<string, unknown>;
  engine: EngineSpec;
}

export interface SharingRunResult {
  runId: string;
  /** What the engine said it is: the string the run records. */
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

export async function runSharing(db: Db, request: SharingRunRequest): Promise<SharingRunResult> {
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
        where object_id = $1 and property_code = 'allocation_key' and scenario_id is null
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

  const described = await describeEngine(request.engine);
  if (!described.kinds.includes('energy_sharing')) {
    throw new Error(`engine_kind_unsupported: ${request.engine.name} accepts ${described.kinds.join(', ')}, not energy_sharing`);
  }

  // The participants taking part over the period, groups left out: a group's meters are its members'.
  const participants = (
    await db.query<ParticipantRow>(
      `select p.id, p.name, p.role, attributes_of(p.id, $2::timestamptz) attributes
         from participants p
        where p.project_id = $1 and p.site_id is not null and p.scenario_id is null
          and (p.join_date is null or p.join_date < $3::timestamptz) and (p.leave_date is null or p.leave_date >= $2::timestamptz)
        order by p.name, p.id`,
      [request.projectId, from, to],
    )
  ).rows;
  if (participants.length === 0) throw new Error(`participants_missing: the project has no participant taking part from ${from} to ${to}`);

  const sent: SharingParticipant[] = [];
  const read: Record<string, Record<string, string[]>> = {};
  for (const p of participants) {
    const series = [];
    read[p.id] = {};
    for (const quantity of SHARING_INPUTS) {
      const ids = (
        await db.query<{ id: string }>(
          `select id from series
            where quantity_code = $2 and kind = 'measured' and scenario_id is null
              and (object_id = $1 or object_id in (select meter_id from participant_meters($1)))
            order by id`,
          [p.id, quantity],
        )
      ).rows.map((r) => r.id);
      read[p.id][quantity] = ids;
      const sum = new Map<number, number>();
      for (const id of ids) {
        for (const b of await resample(db, id, from, to, request.step)) {
          if (b.value === null || b.samples === 0) continue;
          const at = Date.parse(b.bucket);
          sum.set(at, (sum.get(at) ?? 0) + Number(b.value));
        }
      }
      const missing = ids.length === 0 ? 0 : grid.filter((g) => !sum.has(Date.parse(g.at))).length;
      if (missing > 0) throw new Error(`series_incomplete: ${quantity} of ${p.name} misses ${missing} of ${grid.length} steps from ${from} to ${to}`);
      series.push({ quantity_code: quantity, value_kind: 'interval' as const, step: request.step, unit: 'kWh', values: grid.map((g) => ({ at: g.at, value: sum.get(Date.parse(g.at)) ?? 0 })) });
    }
    sent.push({ id: p.id, name: p.name, role: p.role, attributes: p.attributes, series });
  }

  const inputs = {
    engine: { name: request.engine.name, version: described.version, contract: ENGINE_CONTRACT, dependencies: described.dependencies },
    key: { method: key.value.method, parameters, valid_from: key.valid_from && iso(key.valid_from), valid_to: key.valid_to && iso(key.valid_to), source: key.source, source_code: key.source_code },
    rules: request.rules ?? {},
    period: { from, to, step: request.step },
    participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role, attributes: p.attributes, series: read[p.id] })),
    conventions: { time: 'interval start, UTC', energy: 'kWh per step', missing_direction: 'zeros' },
  };

  // The run of these inputs and this engine: the finished one when it exists, the engine is not started again.
  const started = (await db.query<{ run_id: string; finished: boolean }>(
    `select run_id, finished from start_run('community', $1, 'project', $2, null, $3::jsonb)`, [described.version, request.projectId, JSON.stringify(inputs)],
  )).rows[0];
  if (started.finished) {
    const done = (await db.query<{ results: { totals: Record<string, number>; participants: { id: string; series: Record<string, string> }[] } }>(
      'select results from runs where id = $1', [started.run_id])).rows[0].results;
    return { runId: started.run_id, engine: described.version, sharedKwh: Number(done.totals?.shared_energy ?? 0), series: Object.fromEntries(done.participants.map((p) => [p.id, p.series])) };
  }

  const engineRequest: EnergySharingRequest = {
    kind: 'energy_sharing', from, to, step: request.step, participants: sent,
    key: { method: key.value.method, parameters }, rules: request.rules ?? {},
  };
  const answer = await runEngine<EnergySharingRequest, EnergySharingResult>(request.engine, engineRequest);
  if (answer.version !== described.version) throw new Error(`engine_contract_mismatch: ${request.engine.name} described itself as ${described.version} and answered as ${answer.version}`);

  // The answer is stored as it comes, once checked against the request.
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
        object_kind: 'participant', object_id: p.id, quantity_code: quantity, kind: 'simulated', value_kind: 'interval', step: request.step, run_id: started.run_id,
      }, s.values, { unit: s.unit ?? null });
      stored[p.id][quantity] = seriesId;
    }
  }

  const results = {
    totals: answer.result.totals,
    meta: answer.result.meta,
    participants: participants.map((p) => ({ id: p.id, totals: answer.result.participants.find((r) => r.id === p.id)!.totals, series: stored[p.id] })),
  };
  await db.query('select finish_run($1, $2::jsonb)', [started.run_id, JSON.stringify(results)]);
  return { runId: started.run_id, engine: answer.version, sharedKwh: Number(answer.result.totals?.shared_energy ?? 0), series: stored };
}
