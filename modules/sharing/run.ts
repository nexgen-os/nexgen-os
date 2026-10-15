// Energy sharing in a project, computed by an engine and recorded as a run.
//
// The module reads, it does not share: it gathers the participants of a
// project taking part over the period, the offtake and injection metered
// behind each one on one grid of steps, the allocation key the project
// holds and the rules the caller passes (a country's pack, the project's
// statutes); it hands them to an engine of the `energy_sharing` kind
// (engines/energy-sharing.ts) and stores what the engine answers — for each
// participant, what it received from the sharing and gave to it, and what
// is left for its supplier and the grid — as simulated series of the core
// on the participant, then records the run with the engine's version.
//
// Conventions: every stamp dates the start of its step, in UTC; energy in
// kWh per step. A participant with no series of a direction (a producer's
// offtake) sends zeros for it; one whose series misses steps of the period
// is refused by name, never filled.

import { storeSeries } from '../../connectors/index.js';
import type { Db } from '../../formats/db.js';
import { SHARING_INPUTS, SHARING_OUTPUTS, type EnergySharingRequest, type EnergySharingResult, type SharingParticipant } from '../../engines/energy-sharing.js';
import { ENGINE_CONTRACT, describeEngine, runEngine, type EngineSpec } from '../../engines/runner.js';

export interface SharingRunRequest {
  projectId: string;
  /** The allocation key of the project to apply (`sharing.allocation_keys`). */
  keyId: string;
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
  id: string;
  name: string;
  method: string;
  parameters: Record<string, unknown>;
  valid_from: string | null;
  valid_to: string | null;
}

interface ParticipantRow {
  id: string;
  name: string;
  role: SharingParticipant['role'];
}

export async function runSharing(db: Db, request: SharingRunRequest): Promise<SharingRunResult> {
  const project = (await db.query<{ organisation_id: string }>('select organisation_id from projects where id = $1', [request.projectId])).rows[0];
  if (!project) throw new Error(`project_not_found: ${request.projectId}`);
  const key = (
    await db.query<KeyRow>(
      `select id, name, method, parameters, valid_from::text valid_from, valid_to::text valid_to
         from sharing.allocation_keys where id = $1 and project_id = $2`,
      [request.keyId, request.projectId],
    )
  ).rows[0];
  if (!key) throw new Error(`key_not_found: ${request.keyId} is not an allocation key of the project`);

  const grid = (
    await db.query<{ at: string; aligned: boolean }>(
      `select to_char(g at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') at,
              date_bin($3::interval, $1::timestamptz, timestamptz '2000-01-01 00:00:00+00') = $1::timestamptz aligned
         from generate_series($1::timestamptz, $2::timestamptz - $3::interval, $3::interval) g`,
      [request.from, request.to, request.step],
    )
  ).rows;
  if (grid.length === 0) throw new Error(`period_empty: ${request.from} to ${request.to} holds no step of ${request.step}`);
  if (!grid[0].aligned) throw new Error(`period_misaligned: ${request.from} is not on the grid of ${request.step}`);
  const from = grid[0].at;
  const to = new Date(request.to).toISOString().replace('.000Z', 'Z');
  const outside = (key.valid_from !== null && key.valid_from >= to.slice(0, 10)) || (key.valid_to !== null && key.valid_to <= from.slice(0, 10));
  if (outside) throw new Error(`key_outside_period: ${key.name} holds from ${key.valid_from ?? 'ever'} to ${key.valid_to ?? 'ever'}`);

  const described = await describeEngine(request.engine);
  if (!described.kinds.includes('energy_sharing')) {
    throw new Error(`engine_kind_unsupported: ${request.engine.name} accepts ${described.kinds.join(', ')}, not energy_sharing`);
  }

  // The participants taking part over the period, groups left out: a group's meters are its members'.
  const participants = (
    await db.query<ParticipantRow>(
      `select id, name, role from participants
        where project_id = $1 and not is_group and scenario_id is null
          and (join_date is null or join_date < $3::timestamptz) and (leave_date is null or leave_date >= $2::timestamptz)
        order by name, id`,
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
        const values = await db.query<{ bucket: Date; value: number }>('select bucket, value from resample($1, $2, $3, $4::interval)', [id, from, to, request.step]);
        for (const v of values.rows) sum.set(new Date(v.bucket).getTime(), (sum.get(new Date(v.bucket).getTime()) ?? 0) + Number(v.value));
      }
      const missing = ids.length === 0 ? 0 : grid.filter((g) => !sum.has(Date.parse(g.at))).length;
      if (missing > 0) throw new Error(`series_incomplete: ${quantity} of ${p.name} misses ${missing} of ${grid.length} steps from ${from} to ${to}`);
      series.push({ quantity_code: quantity, value_kind: 'interval' as const, step: request.step, unit: 'kWh', values: grid.map((g) => ({ at: g.at, value: sum.get(Date.parse(g.at)) ?? 0 })) });
    }
    sent.push({ id: p.id, name: p.name, role: p.role, series });
  }

  const engineRequest: EnergySharingRequest = {
    kind: 'energy_sharing', from, to, step: request.step, participants: sent,
    key: { method: key.method, parameters: key.parameters }, rules: request.rules ?? {},
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
      const { seriesId } = await storeSeries(
        db,
        { organisationId: project.organisation_id, objectId: p.id, sourceCode: null, source: answer.version, kind: 'simulated', name: `${key.name} ${from} to ${to}` },
        { quantity_code: quantity, value_kind: 'interval', step: request.step, values: s.values },
      );
      stored[p.id][quantity] = seriesId;
    }
  }

  const inputs = {
    engine: { name: request.engine.name, version: answer.version, contract: ENGINE_CONTRACT, dependencies: described.dependencies },
    key: { id: key.id, name: key.name, method: key.method, parameters: key.parameters, valid_from: key.valid_from, valid_to: key.valid_to },
    rules: request.rules ?? {},
    period: { from, to, step: request.step },
    participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role, series: read[p.id] })),
    conventions: { time: 'interval start, UTC', energy: 'kWh per step', missing_direction: 'zeros' },
  };
  const results = {
    totals: answer.result.totals,
    meta: answer.result.meta,
    participants: participants.map((p) => ({ id: p.id, totals: answer.result.participants.find((r) => r.id === p.id)!.totals, series: stored[p.id] })),
  };
  const run = await db.query<{ id: string }>(`select record_run('sharing', $1, $2, null, $3::jsonb, $4::jsonb) id`, [
    answer.version, request.projectId, JSON.stringify(inputs), JSON.stringify(results),
  ]);
  return { runId: run.rows[0].id, engine: answer.version, sharedKwh: Number(answer.result.totals?.shared_energy ?? 0), series: stored };
}
