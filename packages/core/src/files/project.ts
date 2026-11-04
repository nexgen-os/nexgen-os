/**
 * A project described as data — its participants, the meters they carry and
 * the devices behind them — written into the model through the gestures of
 * the core, and written again without a duplicate.
 *
 * What another system holds about a project (a database of an older
 * platform, a spreadsheet, a description tool) is read by its own reader into
 * this one plain shape; `importProject()` is the one way it becomes rows.
 * Nothing is inserted directly: a project is created by `create_project()`,
 * a participant joins by `join_project()`, a meter is declared by
 * `declare_meter()`, a device installed by `install_device()`, an identifier
 * added by `add_identifier()`, so row level security and every refusal of the
 * schema apply as they do to a person typing the same gestures.
 *
 * An import is replayed as often as the other system changes. Each object is
 * looked for before it is written: by an identifier it carries, which names
 * one object of the organisation, then by what names it in its parent — a
 * project by its name in the organisation, a participant by its name in the
 * project, a meter by its scheme and identifier in the project, a device by
 * its name at its participant. What is found is reused and given the
 * identifiers it lacks; what is not is created. A dry run looks for
 * everything and writes nothing.
 *
 * The surfaces run a gesture in one transaction acting as the person
 * (`personSession()`): there an import is written whole or not at all. A
 * caller with a connection of its own holds the transaction itself; an
 * import cut half way is completed by running it again.
 */
import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';

/** An identifier the object is known by elsewhere, in a scheme of `identifier_schemes`. */
export interface IdentifierDescription {
  scheme: string;
  value: string;
}

export interface DeviceDescription {
  /** A code of `device_types`. */
  device_type: string;
  name: string;
  rated_power_kw?: number;
  unit_count?: number;
  installed_on?: string;
  /** Where the description comes from, a code of `sources`. */
  source_code?: string;
  identifiers?: IdentifierDescription[];
}

export interface MeterDescription {
  /** The metering point identifier, in its numbering scheme. */
  identifier: string;
  scheme: string;
  resource?: string;
  direction?: string;
  valid_from?: string;
  name?: string;
  identifiers?: IdentifierDescription[];
}

export interface ParticipantDescription {
  name: string;
  /** producer, consumer or prosumer; consumer when not given. */
  category?: string;
  time_zone?: string;
  /** Its place in the standard shape (`placeFields()`). */
  place?: Record<string, unknown>;
  identifiers?: IdentifierDescription[];
  meters?: MeterDescription[];
  devices?: DeviceDescription[];
}

export interface ProjectDescription {
  name: string;
  /** The ISO 3166-1 alpha-2 country whose rules apply: never assumed. */
  country: string;
  kind?: string;
  start_date?: string;
  identifiers?: IdentifierDescription[];
  participants?: ParticipantDescription[];
}

export type ImportedKind = 'project' | 'participant' | 'meter' | 'device';

/** What became of one object of the description. */
export interface ImportedObject {
  kind: ImportedKind;
  /** Where it is in the description: `participants[2].meters[0]`. */
  path: string;
  name: string;
  /** Found: it was there already. Created: written now. To create: a dry run would write it. */
  outcome: 'found' | 'created' | 'to_create';
  /** Its id; null for an object a dry run would create. */
  id: string | null;
  /** The identifiers added to it (or that a dry run would add). */
  identifiers_added: IdentifierDescription[];
}

export interface ProjectImport {
  dry_run: boolean;
  project_id: string | null;
  objects: ImportedObject[];
  /** Per kind, how many were found and how many created (or would be). */
  counts: Record<ImportedKind, { found: number; created: number }>;
}

export interface ProjectImportOptions {
  /** Look for everything, write nothing. Default: false. */
  dryRun?: boolean;
}

const KINDS: ImportedKind[] = ['project', 'participant', 'meter', 'device'];

async function rows<T>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function idOf(db: Db, sql: string, params: unknown[]): Promise<string | null> {
  const [row] = await rows<{ id: string }>(db, sql, params);
  return row?.id ?? null;
}

/**
 * The object of this kind one of the identifiers names in the organisation,
 * or null. Two identifiers naming two different objects refuse the import:
 * the description says two things of one object.
 */
async function byIdentifiers(db: Db, organisationId: string, kind: ImportedKind, ids: IdentifierDescription[], path: string): Promise<string | null> {
  if (ids.length === 0) return null;
  const found = await rows<{ object_kind: string; object_id: string }>(db,
    `select distinct object_kind, object_id::text from identifiers
      where organisation_id = $1 and (scheme, value) in (select * from unnest($2::text[], $3::text[]))`,
    [organisationId, ids.map((i) => i.scheme), ids.map((i) => i.value)]);
  if (found.length === 0) return null;
  if (found.length > 1 || found[0]!.object_kind !== kind) {
    throw new GestureError(`identifiers_disagree: the identifiers of ${path} name ${found.map((f) => `${f.object_kind} ${f.object_id}`).join(' and ')}`);
  }
  return found[0]!.object_id;
}

/** The identifiers of the description the object does not carry yet. */
async function missingIdentifiers(db: Db, kind: ImportedKind, id: string | null, ids: IdentifierDescription[]): Promise<IdentifierDescription[]> {
  if (id === null || ids.length === 0) return ids;
  const held = await rows<{ scheme: string; value: string }>(db,
    'select scheme, value from identifiers where object_kind = $1 and object_id = $2', [kind, id]);
  return ids.filter((i) => !held.some((h) => h.scheme === i.scheme && h.value === i.value));
}

/** Refuses a description that cannot be written, before anything is: by the path of what is missing. */
function check(d: ProjectDescription): void {
  const need = (value: unknown, code: string, path: string) => {
    if (typeof value !== 'string' || value.trim() === '') throw new GestureError(`${code}: ${path} has none`);
  };
  need(d.name, 'name_required', 'project');
  need(d.country, 'country_required', 'project');
  (d.participants ?? []).forEach((p, i) => {
    need(p.name, 'name_required', `participants[${i}]`);
    (p.meters ?? []).forEach((m, j) => {
      need(m.identifier, 'identifier_required', `participants[${i}].meters[${j}]`);
      need(m.scheme, 'scheme_required', `participants[${i}].meters[${j}]`);
    });
    (p.devices ?? []).forEach((v, j) => {
      need(v.name, 'name_required', `participants[${i}].devices[${j}]`);
      need(v.device_type, 'device_type_required', `participants[${i}].devices[${j}]`);
    });
  });
}

/**
 * Writes a project described as data into an organisation, or finds it
 * there: see the head of this file. Returns what became of each object.
 */
export async function importProject(db: Db, organisationId: string, description: ProjectDescription, options: ProjectImportOptions = {}): Promise<ProjectImport> {
  check(description);
  const dryRun = options.dryRun ?? false;
  const objects: ImportedObject[] = [];

  /** Finds an object, or creates it; then gives it the identifiers it lacks. */
  async function settle(kind: ImportedKind, path: string, name: string, ids: IdentifierDescription[] | undefined,
    find: () => Promise<string | null>, create: () => Promise<string>): Promise<string | null> {
    const identifiers = ids ?? [];
    let id = await byIdentifiers(db, organisationId, kind, identifiers, path) ?? await find();
    const outcome: ImportedObject['outcome'] = id !== null ? 'found' : dryRun ? 'to_create' : 'created';
    const added = await missingIdentifiers(db, kind, id, identifiers);
    if (!dryRun) {
      id ??= await create();
      for (const i of added) await db.query('select add_identifier($1, $2, $3, $4)', [kind, id, i.scheme, i.value]);
    }
    objects.push({ kind, path, name, outcome, id, identifiers_added: added });
    return id;
  }

  const p = description;
  const projectId = await settle('project', 'project', p.name, p.identifiers,
    () => idOf(db, 'select id from projects where organisation_id = $1 and name = $2 order by created_at limit 1', [organisationId, p.name]),
    () => idOf(db, 'select create_project($1, $2, $3, $4, $5) id',
      [organisationId, p.name, p.country, p.kind ?? null, p.start_date ?? null]) as Promise<string>);

  for (const [i, participant] of (p.participants ?? []).entries()) {
    const at = `participants[${i}]`;
    const participantId = await settle('participant', at, participant.name, participant.identifiers,
      async () => projectId === null ? null
        : idOf(db, 'select id from participants where project_id = $1 and name = $2 order by created_at limit 1', [projectId, participant.name]),
      () => idOf(db, `select join_project($1, $2, $3::jsonb, coalesce($4, 'consumer'), p_time_zone => $5) id`,
        [projectId, participant.name, participant.place === undefined ? null : JSON.stringify(participant.place),
         participant.category ?? null, participant.time_zone ?? null]) as Promise<string>);

    for (const [j, m] of (participant.meters ?? []).entries()) {
      await settle('meter', `${at}.meters[${j}]`, m.name ?? m.identifier, m.identifiers,
        async () => {
          if (projectId === null) return null;
          const [open] = await rows<{ id: string; participant_id: string }>(db,
            'select id, participant_id from meters where project_id = $1 and scheme = $2 and identifier = $3 and valid_to is null',
            [projectId, m.scheme, m.identifier]);
          if (open !== undefined && open.participant_id !== participantId) {
            throw new GestureError(`meter_carried_elsewhere: ${m.scheme} ${m.identifier} of ${at} is carried by participant ${open.participant_id} of the project`);
          }
          return open?.id ?? null;
        },
        () => idOf(db, `select declare_meter($1, $2, $3, coalesce($4, 'electricity'), coalesce($5, 'both'), $6, $7) id`,
          [participantId, m.identifier, m.scheme, m.resource ?? null, m.direction ?? null, m.valid_from ?? null, m.name ?? null]) as Promise<string>);
    }

    for (const [j, d] of (participant.devices ?? []).entries()) {
      await settle('device', `${at}.devices[${j}]`, d.name, d.identifiers,
        async () => participantId === null ? null
          : idOf(db, 'select id from devices where participant_id = $1 and name = $2 order by created_at limit 1', [participantId, d.name]),
        () => idOf(db, 'select install_device($1, $2, $3, null, $4, $5, $6, coalesce($7, 1)) id',
          [participantId, d.device_type, d.name, d.rated_power_kw ?? null, d.installed_on ?? null, d.source_code ?? null, d.unit_count ?? null]) as Promise<string>);
    }
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, {
    found: objects.filter((o) => o.kind === k && o.outcome === 'found').length,
    created: objects.filter((o) => o.kind === k && o.outcome !== 'found').length,
  }])) as ProjectImport['counts'];
  return { dry_run: dryRun, project_id: projectId, objects, counts };
}
