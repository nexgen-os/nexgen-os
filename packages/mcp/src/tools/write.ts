/**
 * Describing and equipping: a project, a participant with its place, a
 * meter, a device, the values of a series. Each goes through the schema's
 * function for its gesture, as the person; none writes SQL of its own.
 */
import * as core from '@nexgen-os/core';
import { z } from 'zod';
import { tool, type Tool } from './tool.js';

const uuid = z.string().uuid();
/** Base64 as a file travels in JSON: its alphabet, padding at the end, line breaks allowed. */
const BASE64 = /^[A-Za-z0-9+/\r\n]*={0,2}\s*$/;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('An ISO date, 2026-06-15');

const target = {
  object_kind: z.enum(['organisation', 'project', 'participant', 'meter', 'device']).describe('What the series is about'),
  object_id: uuid,
  organisation_id: uuid,
  quantity_code: z.string().describe('A code of quantities: offtake_energy, injection_energy, production_energy…'),
  kind: z.enum(['measured', 'simulated', 'forecast', 'setpoint']).default('measured'),
  source_code: z.string().describe('A code of sources: where the values come from. Required: a value says where it comes from'),
  name: z.string().optional().describe('Tells apart two series of the same object, quantity, kind and source'),
};

const targetOf = (a: { organisation_id: string; object_kind: string; object_id: string; source_code: string; kind: core.SeriesTarget['kind']; name?: string | undefined }): core.SeriesTarget => ({
  organisationId: a.organisation_id, objectKind: a.object_kind, objectId: a.object_id, sourceCode: a.source_code, kind: a.kind, name: a.name ?? null,
});

export const WRITE_TOOLS: Tool[] = [
  tool({
    name: 'create_project',
    title: 'Create a project',
    description: 'Opens a project in an organisation (create_project()): its name, the ISO country whose rules apply — the person says it, never assume one — and the frame it is carried out in when it has one (kind, a code of project_kinds: a rooftop PV project, a self-consumption operation, an energy community or a legal frame of the country; none otherwise). Next: add_participant.',
    input: z.object({ organisation_id: uuid, name: z.string().min(1), country: z.string().length(2), kind: z.string().optional(), start_date: date.optional() }),
    writes: true,
    run: ({ db }, a) => core.createProject(db, a),
  }),
  tool({
    name: 'add_participant',
    title: 'Add a participant',
    description: 'A participant joins a project with its place (join_project()). Give the place in the standard shape when you have it (country, address_line1, postal_code, city, municipality, geometry as a GeoJSON Point, location_precision, location_source_code — a code of sources), or an address the geocoder chain the person configured finds — the national register of the country first, then the open fallback. Give the time zone when the person knows it; without it, no daily readings.',
    input: z.object({
      project_id: uuid,
      name: z.string().min(1),
      category: z.string().optional().describe('What it does with energy: consumer by default, producer or prosumer'),
      time_zone: z.string().optional().describe('An IANA time zone, Europe/Brussels'),
      place: z.record(z.string(), z.unknown()).optional(),
      address: z.string().optional(),
      country: z.string().length(2).optional().describe('Narrows the geocoder to one country'),
    }),
    writes: true,
    run: ({ db, geocoder }, a) => core.addParticipant(db, a, geocoder),
  }),
  tool({
    name: 'declare_meter',
    title: 'Declare a meter',
    description: 'A meter of a participant (declare_meter()), by its identifier in a scheme of identifier_schemes, which checks it. A meter measures offtake and injection; production is a device\'s.',
    input: z.object({
      participant_id: uuid, identifier: z.string().min(1), scheme: z.string().min(1),
      resource: z.string().optional(), direction: z.enum(['offtake', 'injection', 'both']).optional(),
      valid_from: date.optional(), name: z.string().optional(),
    }),
    writes: true,
    run: ({ db }, a) => core.declareMeter(db, a),
  }),
  tool({
    name: 'install_device',
    title: 'Install a device',
    description: 'A device of a participant (install_device()): its type (device_types), a name, and the product of the catalogue it is, whose power and capacity it takes, or a rated power the person states.',
    input: z.object({
      participant_id: uuid, device_type: z.string(), name: z.string().min(1), product_id: uuid.optional(),
      rated_power_kw: z.number().positive().optional(), installed_on: date.optional(), source_code: z.string().optional(),
      unit_count: z.number().int().positive().optional(),
    }),
    writes: true,
    run: ({ db }, a) => core.installDevice(db, a),
  }),
  tool({
    name: 'set_device_status',
    title: 'Move a device through the works',
    description: 'Where a device stands, moved on a day by a named transition (set_device_status()): planned to installed or in_service, the day becoming its installation date; installed to in_service, or out_of_service when it failed its commissioning; in_service to out_of_service and back. Only on a day that has come, and only what the person says happened: what was done to get there (the commissioning test, its report, the photos) is a step of the commissioning phase and the documents of the device. Removing a device is not this tool. Refuses device_status_invalid, device_day_invalid, device_retired, not_allowed.',
    input: z.object({ device_id: uuid, status: z.enum(['installed', 'in_service', 'out_of_service']), on: date.optional().describe('The day it happened; today otherwise') }),
    writes: true,
    run: ({ db }, a) => core.setDeviceStatus(db, a),
  }),
  tool({
    name: 'import_project',
    title: 'Import a project described as data',
    description: 'A project described as data — its participants with their place and time zone, the meters they carry, the devices behind them, and the identifiers each is known by elsewhere — written through create_project(), join_project(), declare_meter(), install_device() and add_identifier() (importProject()). Each object is looked for first, by an identifier it carries, then by its name in its parent (a meter by its scheme and identifier): the same description given again creates nothing. Run it with dry_run first and show the person what it would create. The country is the person\'s, never assumed.',
    input: z.object({
      organisation_id: uuid,
      description: z.record(z.string(), z.unknown()).describe('{ name, country, kind?, start_date?, identifiers?: [{ scheme, value }], participants?: [{ name, category?, time_zone?, place?, identifiers?, meters?: [{ identifier, scheme, direction?, resource?, valid_from?, name?, identifiers? }], devices?: [{ device_type, name, rated_power_kw?, unit_count?, installed_on?, source_code?, identifiers? }] }] }'),
      dry_run: z.boolean().default(false).describe('Look for everything, write nothing'),
    }),
    writes: true,
    run: ({ db }, a) => core.importProject(db, a.organisation_id, a.description as unknown as core.ProjectDescription, { dryRun: a.dry_run }),
  }),
  tool({
    name: 'import_project_sheet',
    title: 'Import a project sheet',
    description: 'A project sheet — the table of the template of @nexgen-os/project-sheet: one row per meter or device of a participant, columns project, country, participant, its place, meter_scheme, meter_identifier, device_type, device_name… — read, then each project of it imported as import_project does (importProjectSheet()). Give it as the person saved it: `sheet`, the text of a CSV, or `workbook`, the bytes of an .xlsx workbook in base64, with `worksheet` naming the worksheet when it is not the first. A sheet with a cell that cannot be read is refused whole, sheet_unreadable, naming each problem with its line: show them to the person, never correct a cell yourself. Run it with dry_run first. The country is the sheet\'s, never assumed.',
    input: z.object({
      organisation_id: uuid,
      sheet: z.string().optional().describe('The text of a CSV sheet, its header first; comma, semicolon or tab separated'),
      workbook: z.string().max(14_000_000).regex(BASE64).optional().describe('The bytes of an .xlsx workbook, in base64'),
      worksheet: z.string().min(1).optional().describe('The worksheet of the workbook that holds the sheet, by its name; the first one otherwise'),
      dry_run: z.boolean().default(false).describe('Look for everything, write nothing'),
    }),
    writes: true,
    run: ({ db }, a) => {
      if ((a.sheet === undefined) === (a.workbook === undefined)) {
        throw new core.GestureError('sheet_required: give the sheet once, as the text of a CSV (sheet) or as an .xlsx workbook in base64 (workbook)');
      }
      const sheet = a.workbook === undefined ? a.sheet! : new Uint8Array(Buffer.from(a.workbook, 'base64'));
      return core.importProjectSheet(db, a.organisation_id, sheet, { dryRun: a.dry_run, ...(a.worksheet === undefined ? {} : { worksheet: a.worksheet }) });
    },
  }),
  tool({
    name: 'store_series',
    title: 'Store series values',
    description: 'Values of a series through store(), the one write path: the series of the object, quantity, kind and source, found or created once; each value dated at the START of its interval, in `unit` (converted to the unit of the quantity). A value already there is replaced. Never a value you computed yourself.',
    input: z.object({
      ...target,
      value_kind: z.enum(['interval', 'instant', 'cumulative']).default('interval'),
      step: z.string().nullable().default(null).describe('A Postgres interval, 15 minutes; null when irregular'),
      unit: z.string().optional(),
      values: z.array(z.object({ at: z.string(), value: z.number() })).min(1).max(100_000),
    }),
    writes: true,
    run: ({ db }, a) => core.storeSeries(db, targetOf(a), {
      quantity_code: a.quantity_code, value_kind: a.value_kind, step: a.step, values: a.values, ...(a.unit === undefined ? {} : { unit: a.unit }),
    }),
  }),
  tool({
    name: 'import_series',
    title: 'Import series from a file',
    description: 'The readings of a file, read by its format library and written through store(). Formats: homeassistant — a Home Assistant export (registries and recorder states, as JSON text) and the entity whose readings to keep. The file travels as text.',
    input: z.object({
      ...target,
      format: z.enum(['homeassistant']),
      file: z.string().max(10_000_000).describe('The content of the file'),
      entity_id: z.string().describe('The entity of the export: sensor.grid_import'),
    }),
    writes: true,
    run: ({ db }, a) => core.importHomeAssistantSeries(db, targetOf(a), JSON.parse(a.file), a.entity_id, a.quantity_code),
  }),
  tool({
    name: 'create_api_key',
    title: 'Issue a key',
    description: 'A key for a machine or another agent, issued on an organisation by a person who holds members.manage on it, signed in: it acts as them within that organisation and the capabilities on its list (data.read, data.write…, see my_capabilities), read only unless it carries one that writes. The secret is in this answer once; give it to the person, never store it. A key does not issue keys.',
    input: z.object({ organisation_id: uuid, name: z.string().min(1), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)).min(1).default(['data.read']), expires_at: z.string().optional() }),
    writes: true,
    run: ({ db }, a) => core.createApiKey(db, a),
  }),
  tool({
    name: 'revoke_api_key',
    title: 'Withdraw a key',
    description: 'Withdraws a key of an organisation you own, at once and for good. Only on the person\'s word.',
    input: z.object({ api_key_id: uuid }),
    writes: true,
    destructive: true,
    run: ({ db }, a) => core.revokeApiKey(db, a.api_key_id),
  }),
];
