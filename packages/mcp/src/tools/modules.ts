/**
 * The tools of the modules: offered when the module is installed on the
 * database (`modules`), under its code as a prefix, as Ekwo OS offers its
 * modules' tools. A figure comes from the module that computes it, kept in
 * the table named after what it gives, with its provenance; these tools
 * call the module and read back what it kept.
 */
import * as core from '@nexgen-os/core';
import { z } from 'zod';
import { tool, type Tool } from './tool.js';

const uuid = z.string().uuid();
const instant = z.string().describe('An ISO 8601 instant');
const objectKind = z.enum(['participant', 'project', 'meter', 'device']);
const engineName = z.string().regex(/^[a-z0-9_-]+$/)
  .describe('The name of the engine; its command is the one the person configured (NEXGEN_ENGINE_<NAME>), never one given here');

const economics = z.object({
  offtakePricePerKwh: z.number(), injectionPricePerKwh: z.number(), costPerKwp: z.number(),
  horizonYears: z.number().int().positive(), discountRate: z.number(), currency: z.string().length(3),
}).describe('The money of the person, in the currency of the place. Never assumed');

export const MODULE_TOOLS: Tool[] = [
  // ------------------------------------------------------------------- kpis
  tool({
    name: 'kpis_of',
    title: 'Indicators of an object',
    module: 'kpis',
    description: 'The indicators of a participant, a project, a meter or a device over a period (kpis.of()): each value with its unit, its target and whether it is met, and the figure it was kept as.',
    input: z.object({ object_kind: objectKind, object_id: uuid, from: instant, to: instant }),
    writes: false,
    run: ({ db }, a) => core.kpisOf(db, a.object_kind, a.object_id, a.from, a.to),
  }),
  tool({
    name: 'kpis_compute',
    title: 'Compute an indicator',
    module: 'kpis',
    description: 'Computes one indicator of an object over a period and keeps it as a figure (kpis.compute()). Returns the figure id; kpis_of reads it back.',
    input: z.object({ object_kind: objectKind, object_id: uuid, indicator: z.string(), from: instant, to: instant }),
    writes: true,
    run: ({ db }, a) => core.computeKpi(db, a.object_kind, a.object_id, a.indicator, a.from, a.to),
  }),
  // ------------------------------------------------------------------ solar
  tool({
    name: 'solar_estimates',
    title: 'PV estimates',
    module: 'solar',
    description: 'The estimates of the solar module about a participant or a PV system — yields and sizings — with their inputs, their provenance and their results, latest first.',
    input: z.object({ participant_id: uuid.optional(), device_id: uuid.optional(), kind: z.string().optional() }),
    writes: false,
    run: ({ db }, a) => core.estimatesOf(db, 'solar', a),
  }),
  tool({
    name: 'solar_size',
    title: 'Size a PV system',
    module: 'solar',
    description: 'The PV power that best meets a named criterion for a participant (solar.size(), decision 0045), within the limit of its roof or a stated maximum. The criterion is a code of sizing_criteria the person chose — never assume one. Keeps a sizing estimate and returns it.',
    input: z.object({
      participantId: uuid, criterion: z.string(), target: z.number().min(0).max(1).optional(),
      from: instant, to: instant, step: z.string(),
      shape: z.object({ seriesId: uuid, kwp: z.number().positive() }).describe('A production series and the power it was computed for'),
      bounds: z.object({ maxKwp: z.number().positive().optional(), source: z.string().optional() }).optional(),
      economics: economics.optional(),
    }),
    writes: true,
    run: ({ db, computations }, a) => core.compute(db, computations, 'solar.size', a),
  }),
  tool({
    name: 'solar_estimate_yield',
    title: 'Estimate a PV yield',
    module: 'solar',
    description: 'The yield of a PV system over whole years, with a named profile (pvgis_like by default, pvwatts, or an engine), kept in solar.estimates with what it was computed from. It reaches PVGIS on the Internet unless the profile computes here.',
    input: z.object({
      deviceId: uuid, years: z.object({ from: z.number().int(), to: z.number().int() }), profileCode: z.string().optional(),
      raddatabase: z.string().optional(), typicalYear: z.boolean().optional(), anchor: z.enum(['pvgis', 'none']).optional(),
      engine: z.object({ name: engineName }).optional(), replaces: uuid.optional(),
    }),
    writes: true,
    run: ({ db, computations }, a) => core.compute(db, computations, 'solar.yield', a),
  }),
  // ---------------------------------------------------------------- battery
  tool({
    name: 'battery_estimates',
    title: 'Battery estimates',
    module: 'battery',
    description: 'The estimates of the battery module about a participant or a battery — dispatches and sizings — with their inputs, provenance and results, latest first.',
    input: z.object({ participant_id: uuid.optional(), device_id: uuid.optional(), kind: z.string().optional() }),
    writes: false,
    run: ({ db }, a) => core.estimatesOf(db, 'battery', a),
  }),
  tool({
    name: 'battery_size',
    title: 'Size a battery',
    module: 'battery',
    description: 'The battery capacity that best meets a named criterion for a participant or a project (battery.size(), decision 0045), over a period, sweeping the capacities of the bounds. The criterion is the person\'s. Keeps a sizing estimate and returns it.',
    input: z.object({
      perimeter: z.object({ kind: z.enum(['participant', 'project']), id: uuid }),
      criterion: z.enum(['self_consumption_rate', 'self_sufficiency', 'payback', 'net_present_value', 'max_power']),
      from: instant, to: instant, step: z.string().optional(),
      bounds: z.object({ minKwh: z.number().optional(), maxKwh: z.number().optional(), stepKwh: z.number().optional(), points: z.number().int().optional() }).optional(),
    }),
    writes: true,
    run: ({ db, computations }, a) => core.compute(db, computations, 'battery.size', a),
  }),
  // -------------------------------------------------------------- community
  tool({
    name: 'community_settlements',
    title: 'Settlements of a sharing',
    module: 'community',
    description: 'The settlements of the energy shared within a project, latest first: who received what, step by step, and the engine that computed it.',
    input: z.object({ project_id: uuid }),
    writes: false,
    run: ({ db }, a) => core.settlementsOf(db, a.project_id),
  }),
  tool({
    name: 'community_settle',
    title: 'Settle a sharing',
    module: 'community',
    description: 'Settles the energy shared within a project over a period, by the sharing engine the person configured, and keeps the settlement in community.settlements. The rules are what the pack of the country or the project sets.',
    input: z.object({ projectId: uuid, from: instant, to: instant, step: z.string(), engine: z.object({ name: engineName }), replaces: uuid.optional() }),
    writes: true,
    run: ({ db, computations }, a) => core.compute(db, computations, 'community.settle', a),
  }),
  // --------------------------------------------------------------- charging
  tool({
    name: 'charging_sessions',
    title: 'Charging sessions',
    module: 'charging',
    description: 'The charging sessions of a charger or of a participant\'s chargers, latest first: EVSE, start and end, energy delivered, peak power, why it stopped, where it comes from. The id token is personal data and is not returned.',
    input: z.object({ device_id: uuid.optional(), participant_id: uuid.optional(), from: instant.optional(), to: instant.optional() }),
    writes: false,
    run: ({ db }, a) => core.chargingSessionsOf(db, a),
  }),
  tool({
    name: 'charging_limit',
    title: 'Limit a charger',
    module: 'charging',
    description: 'Asks a charger to keep a charging profile (charging.limit(), an OCPP SetChargingProfile): a command action, proposed by you, on the charger\'s setpoint series. Nothing is sent until the person validates it with actions_validate; the station\'s answer marks it done or failed.',
    input: z.object({
      device_id: uuid,
      schedule: z.object({
        evse_id: z.number().int().min(0).optional(),
        purpose: z.enum(['station_max', 'tx_default', 'tx', 'external_constraints']).optional(),
        stack_level: z.number().int().min(0).optional(),
        kind: z.enum(['absolute', 'relative', 'recurring']).optional(),
        recurrency: z.enum(['daily', 'weekly']).optional(),
        rate_unit: z.enum(['W', 'A']),
        starts_at: instant.optional(), duration_s: z.number().int().positive().optional(),
        valid_from: instant.optional(), valid_to: instant.optional(), transaction_id: z.string().optional(),
        periods: z.array(z.object({ start_s: z.number().min(0), limit: z.number().min(0), phases: z.number().int().min(1).max(3).optional() })).min(1),
      }),
    }),
    writes: true,
    run: ({ db }, a) => core.limitCharging(db, a.device_id, a.schedule),
  }),
  tool({
    name: 'charging_size',
    title: 'Size charge points',
    module: 'charging',
    description: 'The number of charge points and their power for a participant or a project (charging.size(), decision 0045), from the arrivals and departures of its vehicles as the person gives them, within the power of its connection. The criterion is the person\'s: demand_served with a target, or max_power. Keeps a sizing estimate and returns it.',
    input: z.object({
      subject: z.object({ kind: z.enum(['participant', 'project']), id: uuid }),
      criterion: z.enum(['demand_served', 'max_power']),
      target: z.number().min(0).max(1).optional(),
      vehicles: z.array(z.object({
        arrival: z.string().regex(/^\d{2}:\d{2}$/), departure: z.string().regex(/^\d{2}:\d{2}$/),
        energyKwh: z.number().min(0), count: z.number().int().positive().optional(),
      })).min(1),
      bounds: z.object({
        powersKw: z.array(z.number().positive()).min(1), maxPoints: z.number().int().positive().optional(),
        connectionKw: z.number().positive().optional(), baseLoadKw: z.number().min(0).optional(),
      }),
    }),
    writes: true,
    run: ({ db, computations }, a) => core.compute(db, computations, 'charging.size', a),
  }),
  // ---------------------------------------------------------------- actions
  tool({
    name: 'actions_of_project',
    title: 'Actions of a project',
    module: 'actions',
    description: 'What is to be done on a project and its participants: steps, recommendations and commands, each with its phase, its status and the estimate its gain rests on.',
    input: z.object({ project_id: uuid }),
    writes: false,
    run: ({ db }, a) => core.actionsOf(db, a.project_id),
  }),
  tool({
    name: 'actions_propose',
    title: 'Propose an action',
    module: 'actions',
    description: 'What you recommend, as an action proposed by an agent (actions.propose(), source agent), resting on the estimate that gives its gain. The person validates it; you never do it for them.',
    input: z.object({
      object_kind: z.string(), object_id: uuid, phase: z.string(), name: z.string().min(1),
      estimate_kind: z.string().optional(), estimate_id: uuid.optional(), gain_per_year: z.number().optional(), horizon_years: z.number().int().optional(),
    }),
    writes: true,
    run: ({ db }, a) => core.proposeAction(db, a),
  }),
  tool({
    name: 'actions_validate',
    title: 'Validate an action',
    module: 'actions',
    description: 'Moves an action along its lifecycle (actions.move()): validated, launched, done, failed or dismissed. Only on the person\'s explicit word.',
    input: z.object({ action_id: uuid, status: z.enum(['validated', 'launched', 'done', 'failed', 'dismissed']), on: z.string().optional() }),
    writes: true,
    destructive: true,
    run: ({ db }, a) => core.moveAction(db, a.action_id, a.status, a.on),
  }),
];

/** The tools of the modules installed, in the order above. */
export function moduleToolsFor(installed: readonly string[]): Tool[] {
  return MODULE_TOOLS.filter((t) => t.module !== undefined && installed.includes(t.module));
}
