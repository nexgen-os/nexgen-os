/**
 * Reading the model: who you are, the six objects, their series and their
 * parameters. Nothing here writes.
 */
import * as core from '@nexgen-os/core';
import { z } from 'zod';
import { tool, type Tool } from './tool.js';

const uuid = z.string().uuid();
const instant = z.string().describe('An ISO 8601 instant, 2026-01-01T00:00:00Z');
const limit = z.number().int().min(1).max(1000).optional().describe('At most this many rows; 100 by default');

/** One list per object of the core, filtered by the columns its list takes. */
const lists: Tool[] = [
  tool({
    name: 'list_organisations',
    title: 'List organisations',
    description: 'The organisations you are a member of. Start here: a project, a participant and everything under them belong to one. Organisations you were never invited to are invisible, not hidden. Next: list_projects.',
    input: z.object({ limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'organisation', {}, a.limit),
  }),
  tool({
    name: 'list_projects',
    title: 'List projects',
    description: 'The projects of an organisation, or every project you can read: a rooftop PV project, an energy community, a study of sites. Each says its kind, the frame it is carried out in (null when none), and the country whose rules apply. Next: list_participants.',
    input: z.object({ organisation_id: uuid.optional(), limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'project', { organisation_id: a.organisation_id }, a.limit),
  }),
  tool({
    name: 'list_participants',
    title: 'List participants',
    description: 'The participants of a project: a household, a school, a company, each with its place, its municipality, its time zone and how precisely it was located. A participant without a time zone has no daily readings; say so. Next: list_meters and list_devices.',
    input: z.object({ project_id: uuid.optional(), organisation_id: uuid.optional(), limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'participant', { project_id: a.project_id, organisation_id: a.organisation_id }, a.limit),
  }),
  tool({
    name: 'list_meters',
    title: 'List meters',
    description: 'The meters of a participant: an identifier in its scheme, the resource, the direction. A meter measures offtake and injection, never production.',
    input: z.object({ participant_id: uuid.optional(), organisation_id: uuid.optional(), limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'meter', { participant_id: a.participant_id, organisation_id: a.organisation_id }, a.limit),
  }),
  tool({
    name: 'list_devices',
    title: 'List devices',
    description: 'The devices of a participant: a PV system, a battery, a heat pump, a charging point, each with its type, its product and its rated power.',
    input: z.object({ participant_id: uuid.optional(), organisation_id: uuid.optional(), limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'device', { participant_id: a.participant_id, organisation_id: a.organisation_id }, a.limit),
  }),
  tool({
    name: 'list_series',
    title: 'List series',
    description: 'The series about an object (by object_id) or of an organisation: the quantity, measured or simulated, the step and the source. Next: read_series with its id.',
    input: z.object({ object_id: uuid.optional(), quantity_code: z.string().optional(), organisation_id: uuid.optional(), limit }),
    writes: false,
    run: ({ db }, a) => core.listObjects(db, 'series', { object_id: a.object_id, quantity_code: a.quantity_code, organisation_id: a.organisation_id }, a.limit),
  }),
];

export const READ_TOOLS: Tool[] = [
  tool({
    name: 'status',
    title: 'Status',
    description: 'The schema version, who you are acting as, the modules installed, and the organisations you can read with your role on each. Call it first when something is refused or empty.',
    input: z.object({}),
    writes: false,
    run: ({ db }) => core.status(db),
  }),
  ...lists,
  tool({
    name: 'get_object',
    title: 'One object',
    description: 'One object of the core by its kind and id — organisation, project, participant, meter, device or series — with its attributes in force (attributes_of()).',
    input: z.object({ kind: z.enum(core.OBJECT_KINDS as [core.ObjectKind, ...core.ObjectKind[]]), id: uuid }),
    writes: false,
    run: ({ db }, a) => core.getObject(db, a.kind, a.id),
  }),
  tool({
    name: 'read_series',
    title: 'Read a series',
    description: 'The values of a series per bucket of a regular step (resample()), in the unit of its quantity, with how many samples each bucket had and expected. A cumulative register gives its consumption per bucket. Dates are the start of each interval.',
    input: z.object({ series_id: uuid, from: instant, to: instant, step: z.string().describe('A Postgres interval: 15 minutes, 1 hour, 1 day') }),
    writes: false,
    run: ({ db }, a) => core.readSeries(db, a.series_id, a.from, a.to, a.step),
  }),
  tool({
    name: 'parameter_of',
    title: 'A parameter of an object',
    description: 'The value of a parameter (an attribute type) for an object, through the cascade of defaults: the object, then its parents, then the pack of its country and region. Null when nothing decides it — never guess one.',
    input: z.object({ kind: z.string(), id: uuid, attribute_type: z.string(), at: instant.optional() }),
    writes: false,
    run: ({ db }, a) => core.parameterOf(db, a.kind, a.id, a.attribute_type, a.at),
  }),
  tool({
    name: 'list_api_keys',
    title: 'Keys of an organisation',
    description: 'The keys of an organisation you manage (members.manage): their name, prefix, capabilities, expiry, last use and withdrawal. Never a secret.',
    input: z.object({ organisation_id: uuid }),
    writes: false,
    run: ({ db }, a) => core.listApiKeys(db, a.organisation_id),
  }),
];
