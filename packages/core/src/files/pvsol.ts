/**
 * A PV*SOL study into the model: `@nexgen-os/pvsol` reads the .pvprj file,
 * and this file gives what it describes to the gestures of the core — the
 * project, its participant and the inverters through `importProject()`, the
 * PV system and its arrays, each with its own orientation, through
 * `describePvSystem()` of the `solar` module. So a study imported again finds
 * what is there and adds only what is new: the PV system is found by its
 * name at its participant.
 *
 * What a study describes is a design: nothing is dated as installed, and the
 * country is the caller's, never assumed. The load profile and the results
 * PV*SOL simulated stay in the study read (`study`) for the module that
 * compares or keeps them; nothing of them is written here.
 *
 * A study whose arrays lack a power or an orientation is refused before
 * anything is written, `pvsol_incomplete`: an importer never guesses a
 * figure. What the reader named stays as warnings.
 */
import { readPvsolStudy, type PvsolProblem, type PvsolStudy } from '@nexgen-os/pvsol';
import type { Db } from '../db.js';
import { describePvSystem, requireModule } from '../gestures.js';
import { GestureError } from '../refusal.js';
import { importProject, type ProjectDescription, type ProjectImport, type ProjectImportOptions } from './project.js';

export interface PvsolImportOptions extends ProjectImportOptions {
  /** The ISO 3166-1 alpha-2 country whose rules apply: a study does not say it. */
  country: string;
  /** The project's name; the study's title when not given. */
  project?: string;
  /** The participant's name; the study's customer company, then its title, when not given. */
  participant?: string;
  /** The participant's IANA time zone, when the caller knows it. */
  time_zone?: string;
}

export interface PvsolImport {
  dry_run: boolean;
  /** What became of the project, its participant and the inverters. */
  project: ProjectImport;
  /** The PV system: found by its name at the participant, created, or to create on a dry run. */
  pv_system: { name: string; outcome: 'found' | 'created' | 'to_create'; device_id: string | null; arrays: string[] };
  /** What the reader named in the study. */
  warnings: PvsolProblem[];
  /** The study as read, its load profile and results included. */
  study: PvsolStudy;
}

/** The name a study gives its PV system, its project and its participant, unless the caller names them. */
function names(study: PvsolStudy, options: PvsolImportOptions) {
  const title = study.project.title ?? 'PV*SOL study';
  return { project: options.project ?? title, participant: options.participant ?? study.project.customer_company ?? title, system: title };
}

/**
 * A study as the description `importProject()` takes: the project in the
 * caller's country, one participant — a prosumer when the study carries a
 * consumption, a producer otherwise — at the address of the system as the
 * study writes it, in one line for a geocoder to place, and its inverters by
 * manufacturer and model, with their count.
 */
export function projectOfPvsolStudy(study: PvsolStudy, options: PvsolImportOptions): ProjectDescription {
  const named = names(study, options);
  const consumes = study.load_profile !== null || (study.results?.consumption_kwh ?? 0) > 0;
  return {
    name: named.project,
    country: options.country,
    participants: [{
      name: named.participant,
      category: consumes ? 'prosumer' : 'producer',
      place: { country: options.country, ...(study.project.site_address ? { address_line1: study.project.site_address } : {}) },
      ...(options.time_zone ? { time_zone: options.time_zone } : {}),
      devices: study.inverters.map((i) => ({
        device_type: 'inverter',
        name: [i.manufacturer, i.model].filter(Boolean).join(' ') || 'Inverter',
        unit_count: i.count,
      })),
    }],
  };
}

/**
 * Writes a PV*SOL study — the bytes of its .pvprj file or the study already
 * read — into an organisation, or finds it there: see the head of this file.
 * Refuses `pvsol_unreadable` (not a PV*SOL study), `pvsol_incomplete` (an
 * array without a power or an orientation, or no array at all),
 * `module_not_installed` (the `solar` module holds the arrays), and what
 * `importProject()` and `describePvSystem()` refuse.
 */
export async function importPvsolStudy(db: Db, organisationId: string, file: Uint8Array | PvsolStudy, options: PvsolImportOptions): Promise<PvsolImport> {
  let study: PvsolStudy;
  try {
    study = file instanceof Uint8Array ? readPvsolStudy(file) : file;
  } catch (e) {
    throw new GestureError((e as Error).message);
  }
  if (study.arrays.length === 0) throw new GestureError('pvsol_incomplete: the study holds no array with modules');
  const arrays = study.arrays.map((a) => {
    if (a.power_kwp === null || a.azimuth_deg === null || a.tilt_deg === null) {
      const missing = [a.power_kwp === null && 'power', a.azimuth_deg === null && 'azimuth', a.tilt_deg === null && 'tilt'].filter(Boolean).join(', ');
      throw new GestureError(`pvsol_incomplete: the array ${a.name} has no ${missing}`);
    }
    return { name: a.name, azimuth_deg: a.azimuth_deg, tilt_deg: a.tilt_deg, kwp: a.power_kwp };
  });

  await requireModule(db, 'solar');
  const named = names(study, options);
  const project = await importProject(db, organisationId, projectOfPvsolStudy(study, options), options);
  const participantId = project.objects.find((o) => o.kind === 'participant')?.id ?? null;
  const found = participantId === null ? undefined
    : (await db.query<{ id: string }>(`select id from devices where participant_id = $1 and name = $2 and device_type = 'solar'`, [participantId, named.system])).rows[0];

  let pvSystem: PvsolImport['pv_system'];
  if (found) {
    const rows = (await db.query<{ id: string }>('select id from solar.pv_arrays where device_id = $1 order by name', [found.id])).rows;
    pvSystem = { name: named.system, outcome: 'found', device_id: found.id, arrays: rows.map((r) => r.id) };
  } else if (options.dryRun || participantId === null) {
    pvSystem = { name: named.system, outcome: 'to_create', device_id: null, arrays: [] };
  } else {
    const kwp = Math.round(arrays.reduce((s, a) => s + a.kwp, 0) * 1e6) / 1e6;
    const made = await describePvSystem(db, { participant_id: participantId, name: named.system, kwp, arrays });
    pvSystem = { name: named.system, outcome: 'created', device_id: made.device_id, arrays: made.arrays };
  }
  return { dry_run: options.dryRun ?? false, project, pv_system: pvSystem, warnings: study.problems, study };
}
