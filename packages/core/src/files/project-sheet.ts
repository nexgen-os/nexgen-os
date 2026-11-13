/**
 * A project sheet into the model: `@nexgen-os/project-sheet` reads the table
 * a spreadsheet saves, as CSV or as its .xlsx workbook — a project, its participants with their place, the
 * meters they carry, the devices behind them — and this file gives each
 * project of it to `importProject()`, the one way a project described as
 * data becomes rows. So a sheet written again finds what is there and adds
 * only what is new, as any description does.
 *
 * A sheet the reader could not read whole is refused before anything is
 * written, `sheet_unreadable`, with the line and the name of each problem:
 * an importer never guesses what a cell meant. A column the sheet does not
 * know is left aside and given back as a warning.
 */
import { readProjectSheet, readProjectWorkbook, type ProjectSheet, type SheetIdentifier, type SheetProblem, type SheetProject } from '@nexgen-os/project-sheet';
import type { Db } from '../db.js';
import { GestureError } from '../refusal.js';
import { importProject, type IdentifierDescription, type ProjectDescription, type ProjectImport, type ProjectImportOptions } from './project.js';

export interface ProjectSheetImport {
  dry_run: boolean;
  /** What the reader left aside: the columns it does not know. */
  warnings: SheetProblem[];
  /** One import per project of the sheet, in the order of the sheet. */
  projects: ProjectImport[];
}

const ids = (list: SheetIdentifier[]): IdentifierDescription[] | undefined =>
  list.length === 0 ? undefined : list.map((i) => ({ scheme: i.scheme, value: i.value }));

/** The fields of an object that the sheet gives, and none it leaves empty. */
function given<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * A project of a sheet as the description `importProject()` takes. A place
 * carries its point when the sheet gives one (longitude, latitude, at
 * height 0, as `placeFields()` writes it).
 */
export function projectOfSheet(project: SheetProject): ProjectDescription {
  return {
    name: project.name,
    country: project.country ?? '',
    ...given({ kind: project.kind, start_date: project.start_date, identifiers: ids(project.identifiers) }),
    participants: project.participants.map((p) => ({
      name: p.name,
      ...given({
        category: p.category,
        time_zone: p.time_zone,
        identifiers: ids(p.identifiers),
        place: p.place === undefined ? undefined : given({
          address_line1: p.place.address_line1,
          address_line2: p.place.address_line2,
          postal_code: p.place.postal_code,
          city: p.place.city,
          region: p.place.region,
          country: p.place.country,
          geometry: p.place.latitude === undefined || p.place.longitude === undefined ? undefined
            : { type: 'Point', coordinates: [p.place.longitude, p.place.latitude, 0] },
          location_precision: p.place.location_precision,
        }),
      }),
      meters: p.meters.map((m) => ({
        identifier: m.identifier, scheme: m.scheme,
        ...given({ name: m.name, resource: m.resource, direction: m.direction, valid_from: m.valid_from }),
      })),
      devices: p.devices.map((d) => ({
        device_type: d.device_type, name: d.name,
        ...given({ rated_power_kw: d.rated_power_kw, unit_count: d.unit_count, installed_on: d.installed_on, identifiers: ids(d.identifiers) }),
      })),
    })),
  };
}

/** One problem as a person reads it: `line 4 invalid_number device_rated_power_kw "12,5"`. */
function said(p: SheetProblem): string {
  return [`line ${p.line}`, p.code, p.column, p.value === undefined ? undefined : JSON.stringify(p.value)].filter(Boolean).join(' ');
}

/**
 * Writes the projects of a sheet — its text (CSV), the bytes of an .xlsx
 * workbook, or the sheet already read — into an organisation, or finds them there: see the head of this file.
 * Refuses `sheet_unreadable` with every problem the reader named, and
 * `sheet_empty` for a sheet that describes no project.
 */
export async function importProjectSheet(db: Db, organisationId: string, sheet: string | Uint8Array | ProjectSheet, options: ProjectImportOptions = {}): Promise<ProjectSheetImport> {
  const read = typeof sheet === 'string' ? readProjectSheet(sheet)
    : sheet instanceof Uint8Array ? readProjectWorkbook(sheet) : sheet;
  const errors = read.problems.filter((p) => p.level === 'error');
  if (errors.length > 0) throw new GestureError(`sheet_unreadable: ${errors.map(said).join('; ')}`);
  if (read.projects.length === 0) throw new GestureError('sheet_empty: the sheet describes no project');
  const projects: ProjectImport[] = [];
  for (const project of read.projects) projects.push(await importProject(db, organisationId, projectOfSheet(project), options));
  return { dry_run: options.dryRun ?? false, warnings: read.problems.filter((p) => p.level === 'warning'), projects };
}
