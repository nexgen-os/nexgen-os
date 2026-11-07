/**
 * The history another platform holds — its organisations, their projects,
 * the participants with their place, meters and devices, the readings of
 * those meters, the mandates under which they were read and the statements
 * the platform drew from them — written into the model, written again every
 * night without a duplicate, and reconciled with what the platform holds,
 * per participant and per month, to the kilowatt-hour.
 *
 * The platform is read by its own reader (a connector of
 * `packages/connectors/`) into one plain shape, `HistoryDescription`; this
 * file never knows which platform it came from. Every row is written through
 * the functions of the core, as a person: an organisation by
 * `create_organisation()`, a project and what it holds by `importProject()`,
 * readings by `store()`, a mandate by `grid.request_mandate()` and
 * `grid.decide_mandate()`. Row level security and every refusal of the
 * schema apply.
 *
 * Replayed without a duplicate: each object carries the platform's id of its
 * record as an identifier (`HistoryDescription.scheme`), by which it is found
 * the next night; a value already stored is left as it is (`store()` counts
 * only what changed); a mandate is found by its meter, operator and start.
 *
 * Three modes, one report:
 * - `apply` writes, then reconciles;
 * - `dry_run` writes inside a savepoint, reconciles, and rolls back: the
 *   report says exactly what `apply` would do, and nothing stays;
 * - `report` writes nothing and reconciles what the model already holds.
 *
 * Each project is written in a savepoint of its own: a project refused by the
 * schema is listed with the name of its refusal and the others go on. The
 * caller holds the transaction (the surfaces do, `personSession()`).
 *
 * The report names no person: an object is given by its id in the model and
 * the id of its record in the platform, never by its name, its place or its
 * metering point; a refusal by its name, never by its message.
 */
import type { Db } from '../db.js';
import { store, type SeriesPoint } from '../series.js';
import { importProject, type IdentifierDescription, type ImportedKind, type ProjectDescription } from './project.js';

export type HistoryKind = 'organisation' | ImportedKind | 'mandate';

export interface OrganisationHistory {
  /** The id of the organisation's record in the platform. */
  ref: string;
  name: string;
  projects: ProjectDescription[];
}

/** The readings of one meter for one quantity, as the platform holds them. */
export interface MeterReadings {
  /** The meter, by the identifier it is declared under in the description. */
  scheme: string;
  identifier: string;
  /** `offtake_energy` or `injection_energy`: a meter measures offtake and injection. */
  quantity_code: string;
  /** A Postgres interval: `15 minutes`. */
  step: string;
  /** In the quantity's unit (kWh), each dated at the start of its interval. */
  values: SeriesPoint[];
}

/** A mandate the meter's customer gave, to read it at its operator's hub. */
export interface MandateHistory {
  scheme: string;
  identifier: string;
  /** A code of `grid.operators`; the operator of the meter when absent. */
  operator?: string;
  /** ISO 8601 duration of the finest step: `PT15M`. */
  granularity: string;
  scope: string[];
  purpose: string;
  valid_from: string;
  valid_to?: string | null;
  data_from?: string | null;
  data_to?: string | null;
  status: 'draft' | 'sent' | 'approved' | 'refused';
  external_reference?: string | null;
}

/** What the platform counted for a participant over a month, in kWh: its periodic statement. */
export interface StatementLine {
  /** The id of the participant's record in the platform. */
  participant_ref: string;
  /** `YYYY-MM`, in the participant's time zone. */
  month: string;
  quantity_code: string;
  kwh: number;
}

export interface HistoryDescription {
  /** The `sources` row of the platform: the provenance of every series written. */
  source_code: string;
  /** The `identifier_schemes` row of the platform's record ids. */
  scheme: string;
  organisations: OrganisationHistory[];
  readings?: MeterReadings[];
  mandates?: MandateHistory[];
  statements?: StatementLine[];
}

export type HistoryMode = 'dry_run' | 'apply' | 'report';

export interface HistoryOptions {
  mode?: HistoryMode;
  /** A month whose two sums differ by less is equal. Default 0.5: equal to the kilowatt-hour. */
  toleranceKwh?: number;
}

/** One object of the description, by its ids only. */
export interface HistoryObject {
  kind: HistoryKind;
  /** The id of its record in the platform (the identifier in `scheme`), or its path when it has none. */
  ref: string;
  outcome: 'found' | 'created' | 'to_create' | 'failed';
  id: string | null;
  /** The name of the refusal, for a failed object. */
  refusal?: string;
}

/** One participant, one month, one quantity: what the platform holds and what the model holds. */
export interface MonthLine {
  participant_ref: string;
  participant_id: string | null;
  month: string;
  quantity_code: string;
  /** The sum of the platform's readings. */
  source_kwh: number;
  /** The sum the model gives back (`resample()`), null when it holds nothing. */
  nexgen_kwh: number | null;
  /** The platform's statement of the month, when it drew one. */
  statement_kwh: number | null;
  /** nexgen_kwh − source_kwh. */
  difference_kwh: number | null;
  status: 'equal' | 'differs' | 'missing' | 'failed';
  refusal?: string;
}

export interface HistoryReport {
  mode: HistoryMode;
  source_code: string;
  counts: Record<HistoryKind, { found: number; created: number; failed: number }>;
  readings: { series: number; values: number; changed: number };
  objects: HistoryObject[];
  months: MonthLine[];
  totals: { lines: number; equal: number; differs: number; missing: number; failed: number; statements_differ: number };
  /** What the import moved and what this report keeps of it. */
  personal_data: string;
}

const KINDS: HistoryKind[] = ['organisation', 'project', 'participant', 'meter', 'device', 'mandate'];

export const HISTORY_PERSONAL_DATA =
  'The import moves personal data of the participants (their names, places, metering point identifiers, readings and mandates) ' +
  "from the platform's database into this model, both run for the same controller. This report keeps none of it: " +
  'each object is given by its id in the model and the id of its record in the platform, each refusal by its name.';

/** The name a refusal starts with (`meter_carried_elsewhere: …`), never its message. */
export function refusalName(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^([a-z][a-z0-9_]*):/.exec(message)?.[1] ?? 'refused';
}

const round = (v: number) => Math.round(v * 1000) / 1000;

async function savepoint<T>(db: Db, name: string, fn: () => Promise<T>, keep: boolean): Promise<T> {
  await db.query(`savepoint ${name}`);
  try {
    const result = await fn();
    await db.query(keep ? `release savepoint ${name}` : `rollback to savepoint ${name}`);
    return result;
  } catch (error) {
    await db.query(`rollback to savepoint ${name}`);
    throw error;
  }
}

async function idOf(db: Db, sql: string, params: unknown[]): Promise<string | null> {
  const r = await db.query<{ id: string | null }>(sql, params);
  return r.rows[0]?.id ?? null;
}

/** The ref of an object of the description: its identifier in the platform's scheme. */
function refOf(ids: IdentifierDescription[] | undefined, scheme: string, fallback: string): string {
  return ids?.find((i) => i.scheme === scheme)?.value ?? fallback;
}

/** The open meter of the organisation declared under this identifier, with its participant. */
async function meterOf(db: Db, scheme: string, identifier: string) {
  const r = await db.query<{ id: string; participant_id: string; time_zone: string | null; organisation_id: string }>(
    `select m.id, m.participant_id, p.time_zone, m.organisation_id from meters m join participants p on p.id = m.participant_id
      where m.scheme = $1 and m.identifier = $2 and m.valid_to is null order by m.created_at limit 1`, [scheme, identifier]);
  return r.rows[0] ?? null;
}

/**
 * Imports the history of a platform, or says what an import would do, and
 * reconciles it month by month: see the head of this file.
 */
export async function importHistory(db: Db, history: HistoryDescription, options: HistoryOptions = {}): Promise<HistoryReport> {
  const mode = options.mode ?? 'dry_run';
  if (mode === 'dry_run') {
    const report = await savepoint(db, 'history_dry_run', () => run(db, history, { ...options, mode: 'apply' }), false);
    return {
      ...report,
      mode,
      objects: report.objects.map((o) => (o.outcome === 'created' ? { ...o, outcome: 'to_create', id: null } : o)),
    };
  }
  return run(db, history, { ...options, mode });
}

async function run(db: Db, history: HistoryDescription, options: HistoryOptions & { mode: 'apply' | 'report' }): Promise<HistoryReport> {
  const write = options.mode === 'apply';
  const tolerance = options.toleranceKwh ?? 0.5;
  const objects: HistoryObject[] = [];
  /** The participant of the model each participant ref became, and the ref each meter is carried by. */
  const participantOfRef = new Map<string, string | null>();
  const refOfMeter = new Map<string, string>();

  for (const [o, organisation] of history.organisations.entries()) {
    const orgRef = organisation.ref;
    let organisationId = await idOf(db,
      `select object_id::text id from identifiers where object_kind = 'organisation' and scheme = $1 and value = $2 limit 1`,
      [history.scheme, orgRef]);
    objects.push({ kind: 'organisation', ref: orgRef, outcome: organisationId !== null ? 'found' : write ? 'created' : 'to_create', id: organisationId });
    if (organisationId === null && write) {
      try {
        organisationId = await savepoint(db, `history_org_${o}`, async () => {
          const id = (await idOf(db, 'select create_organisation($1) id', [organisation.name]))!;
          await db.query(`select add_identifier('organisation', $1, $2, $3)`, [id, history.scheme, orgRef]);
          return id;
        }, true);
        objects[objects.length - 1]!.id = organisationId;
      } catch (error) {
        Object.assign(objects[objects.length - 1]!, { outcome: 'failed', refusal: refusalName(error) });
      }
    }

    for (const [p, project] of organisation.projects.entries()) {
      const at = `organisations[${o}].projects[${p}]`;
      const ref = (_kind: HistoryKind, ids: IdentifierDescription[] | undefined, path: string) => refOf(ids, history.scheme, `${at}.${path}`);
      project.participants?.forEach((participant, i) => {
        const pRef = ref('participant', participant.identifiers, `participants[${i}]`);
        participantOfRef.set(pRef, null);
        for (const m of participant.meters ?? []) refOfMeter.set(`${m.scheme} ${m.identifier}`, pRef);
      });
      if (organisationId === null) {
        if (!write) objects.push({ kind: 'project', ref: ref('project', project.identifiers, 'project'), outcome: 'to_create', id: null });
        continue;
      }
      try {
        const imported = await savepoint(db, `history_project_${o}_${p}`,
          () => importProject(db, organisationId!, project, { dryRun: !write }), true);
        for (const object of imported.objects) {
          const described = describedAt(project, object.path);
          const objectRef = ref(object.kind, described?.identifiers, object.path);
          objects.push({ kind: object.kind, ref: objectRef, outcome: object.outcome, id: object.id });
          if (object.kind === 'participant') participantOfRef.set(objectRef, object.id);
        }
      } catch (error) {
        objects.push({ kind: 'project', ref: ref('project', project.identifiers, 'project'), outcome: 'failed', id: null, refusal: refusalName(error) });
      }
    }
  }

  // Readings: one series per meter and quantity, its values stored once.
  const stored = { series: 0, values: 0, changed: 0 };
  const seriesOf = new Map<string, string | null>();
  const refusals = new Map<string, string>();
  for (const [r, reading] of (history.readings ?? []).entries()) {
    const key = `${reading.scheme} ${reading.identifier} ${reading.quantity_code}`;
    const meter = await meterOf(db, reading.scheme, reading.identifier);
    if (meter === null) {
      refusals.set(key, 'meter_not_found');
      continue;
    }
    if (write) {
      try {
        const result = await savepoint(db, `history_readings_${r}`, async () => {
          let changed = 0;
          let seriesId = '';
          for (let i = 0; i < reading.values.length; i += 10_000) {
            const chunk = await store(db, {
              object_kind: 'meter', object_id: meter.id, quantity_code: reading.quantity_code, kind: 'measured',
              value_kind: 'interval', step: reading.step, source_code: history.source_code,
            }, reading.values.slice(i, i + 10_000));
            seriesId = chunk.seriesId;
            changed += chunk.changed;
          }
          return { seriesId, changed };
        }, true);
        seriesOf.set(key, result.seriesId || null);
        stored.series += 1;
        stored.values += reading.values.length;
        stored.changed += result.changed;
      } catch (error) {
        refusals.set(key, refusalName(error));
      }
    } else {
      seriesOf.set(key, await idOf(db,
        `select id::text id from series where object_kind = 'meter' and object_id = $1 and quantity_code = $2 and kind = 'measured'
            and source_code = $3 and name is null limit 1`, [meter.id, reading.quantity_code, history.source_code]));
    }
  }

  // Mandates: found by their meter, operator and start, or requested and decided as the platform recorded them.
  for (const [k, mandate] of (history.mandates ?? []).entries()) {
    const ref = `${refOfMeter.get(`${mandate.scheme} ${mandate.identifier}`) ?? 'meter'}:mandate:${mandate.valid_from}`;
    const meter = await meterOf(db, mandate.scheme, mandate.identifier);
    if (meter === null) {
      objects.push({ kind: 'mandate', ref, outcome: 'failed', id: null, refusal: 'meter_not_found' });
      continue;
    }
    try {
      const found = await idOf(db,
        `select id::text id from grid.mandates where meter_id = $1 and valid_from = $2::date
            and ($3::text is null or operator = $3) order by created_at limit 1`, [meter.id, mandate.valid_from, mandate.operator ?? null]);
      if (found !== null || !write) {
        objects.push({ kind: 'mandate', ref, outcome: found !== null ? 'found' : 'to_create', id: found });
        continue;
      }
      const id = await savepoint(db, `history_mandate_${k}`, async () => {
        const created = (await idOf(db,
          'select grid.request_mandate($1, $2, $3::text[], $4, $5::date, $6::date, $7::date, $8::date, $9) id',
          [meter.id, mandate.granularity, mandate.scope, mandate.purpose, mandate.valid_from, mandate.valid_to ?? null,
            mandate.data_from ?? null, mandate.data_to ?? null, mandate.operator ?? null]))!;
        if (mandate.status === 'approved' || mandate.status === 'refused') {
          await db.query('select grid.decide_mandate($1, $2, null, $3)', [created, mandate.status === 'approved', mandate.external_reference ?? null]);
        }
        return created;
      }, true);
      objects.push({ kind: 'mandate', ref, outcome: 'created', id });
    } catch (error) {
      objects.push({ kind: 'mandate', ref, outcome: 'failed', id: null, refusal: refusalName(error) });
    }
  }

  // Reconciliation: per meter and month, then summed per participant.
  const lines = new Map<string, MonthLine>();
  for (const [r, reading] of (history.readings ?? []).entries()) {
    const key = `${reading.scheme} ${reading.identifier} ${reading.quantity_code}`;
    const participantRef = refOfMeter.get(`${reading.scheme} ${reading.identifier}`) ?? `readings[${r}]`; // never the metering point itself
    const meter = await meterOf(db, reading.scheme, reading.identifier);
    const add = (month: string, source: number, nexgen: number | null, refusal?: string) => {
      const lineKey = `${participantRef} ${month} ${reading.quantity_code}`;
      const line = lines.get(lineKey) ?? {
        participant_ref: participantRef, participant_id: meter?.participant_id ?? participantOfRef.get(participantRef) ?? null,
        month, quantity_code: reading.quantity_code, source_kwh: 0, nexgen_kwh: null, statement_kwh: null, difference_kwh: null,
        status: 'missing' as MonthLine['status'],
      };
      line.source_kwh += source;
      if (nexgen !== null) line.nexgen_kwh = (line.nexgen_kwh ?? 0) + nexgen;
      if (refusal !== undefined) line.refusal = refusal;
      lines.set(lineKey, line);
    };
    const timeZone = meter?.time_zone ?? null;
    if (timeZone === null) {
      // Without the participant's time zone there is no month: the platform's sum stands alone, in UTC.
      for (const m of await monthsOf(db, reading.values, 'UTC')) add(m.month, m.kwh, null, refusals.get(key) ?? (meter === null ? 'meter_not_found' : 'time_zone_required'));
      continue;
    }
    const source = await monthsOf(db, reading.values, timeZone);
    const seriesId = seriesOf.get(key) ?? null;
    const held = seriesId === null || source.length === 0 ? new Map<string, number>() : new Map((await db.query<{ month: string; kwh: number | null }>(
      `with span as (select date_trunc('month', min(t) at time zone $2) at time zone $2 f,
                            (date_trunc('month', max(t) at time zone $2) + interval '1 month') at time zone $2 t
                       from unnest($3::timestamptz[]) t)
       select to_char(r.bucket at time zone $2, 'YYYY-MM') as month, r.value kwh
         from span, resample($1::uuid, span.f, span.t, '1 month', $2) r`,
      [seriesId, timeZone, reading.values.map((v) => v.at)])).rows.filter((b) => b.kwh !== null).map((b) => [b.month, Number(b.kwh)]));
    for (const m of source) add(m.month, m.kwh, held.get(m.month) ?? null, refusals.get(key));
  }
  for (const s of history.statements ?? []) {
    const line = lines.get(`${s.participant_ref} ${s.month} ${s.quantity_code}`);
    if (line !== undefined) line.statement_kwh = (line.statement_kwh ?? 0) + s.kwh;
  }
  const months = [...lines.values()].map((l) => {
    const difference = l.nexgen_kwh === null ? null : round(l.nexgen_kwh - l.source_kwh);
    const status: MonthLine['status'] = l.refusal !== undefined ? 'failed'
      : difference === null ? 'missing' : Math.abs(difference) < tolerance ? 'equal' : 'differs';
    return {
      ...l, source_kwh: round(l.source_kwh), nexgen_kwh: l.nexgen_kwh === null ? null : round(l.nexgen_kwh),
      statement_kwh: l.statement_kwh === null ? null : round(l.statement_kwh), difference_kwh: difference, status,
    };
  }).sort((a, b) => a.participant_ref.localeCompare(b.participant_ref) || a.month.localeCompare(b.month) || a.quantity_code.localeCompare(b.quantity_code));

  const counts = Object.fromEntries(KINDS.map((k) => [k, {
    found: objects.filter((x) => x.kind === k && x.outcome === 'found').length,
    created: objects.filter((x) => x.kind === k && (x.outcome === 'created' || x.outcome === 'to_create')).length,
    failed: objects.filter((x) => x.kind === k && x.outcome === 'failed').length,
  }])) as HistoryReport['counts'];
  const by = (s: MonthLine['status']) => months.filter((m) => m.status === s).length;
  return {
    mode: options.mode, source_code: history.source_code, counts, readings: stored, objects, months,
    totals: {
      lines: months.length, equal: by('equal'), differs: by('differs'), missing: by('missing'), failed: by('failed'),
      statements_differ: months.filter((m) => m.statement_kwh !== null && Math.abs(m.statement_kwh - m.source_kwh) >= tolerance).length,
    },
    personal_data: HISTORY_PERSONAL_DATA,
  };
}

/** The platform's readings summed per month of a time zone. */
async function monthsOf(db: Db, values: SeriesPoint[], timeZone: string): Promise<{ month: string; kwh: number }[]> {
  if (values.length === 0) return [];
  const r = await db.query<{ month: string; kwh: number }>(
    `select to_char(t at time zone $3, 'YYYY-MM') as month, sum(v) kwh
       from unnest($1::timestamptz[], $2::float8[]) as x(t, v) group by 1 order by 1`,
    [values.map((v) => v.at), values.map((v) => v.value), timeZone]);
  return r.rows.map((m) => ({ month: m.month, kwh: Number(m.kwh) }));
}

/** The object of a project description at a path of `importProject()`'s report. */
function describedAt(project: ProjectDescription, path: string): { identifiers?: IdentifierDescription[] } | undefined {
  if (path === 'project') return project;
  const m = /^participants\[(\d+)\](?:\.(meters|devices)\[(\d+)\])?$/.exec(path);
  if (m === null) return undefined;
  const participant = project.participants?.[Number(m[1])];
  if (m[2] === undefined) return participant;
  return (m[2] === 'meters' ? participant?.meters : participant?.devices)?.[Number(m[3])];
}
