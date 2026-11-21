/**
 * Reading a refusal of the database — once, for every surface.
 *
 * The schema raises with a name first (`time_zone_required: …`,
 * `api_key_revoked: …`, decision 0038). The MCP server hands that name to a
 * model and the command line prints it and exits, so both agree here on what
 * a name is and on what counts as the database saying no. The shape is Ekwo
 * OS's (`refusal.ts`), so an agent reads both projects the same way.
 */

import { GestureError, refusalCode } from '@nexgen-os/connector';

// The name of a refusal and the error that carries it live in
// `@nexgen-os/connector`, MIT, so that a connector refuses by name without
// the core (decision 0064); the core re-exports them.
export { GestureError, refusalCode } from '@nexgen-os/connector';

/**
 * Whether an SQLSTATE is the database declining, as opposed to failing: a
 * raise of its own (`P0001`, `P0002`), a right the caller does not hold or a
 * policy (`42501`), a key refused (`28000`), a read-only transaction
 * (`25006`), a constraint (class `23`).
 */
export function isRefusalState(sqlstate: string | undefined): boolean {
  if (sqlstate === undefined) return false;
  if (['P0001', 'P0002', '42501', '28000', '25006'].includes(sqlstate)) return true;
  return sqlstate.startsWith('23');
}

/** The error a surface reports for whatever the database or a gesture threw. */
export function explain(error: unknown): GestureError {
  if (error instanceof GestureError) return error;
  const e = error as { message?: string; code?: string };
  const message = String(e?.message ?? error);
  if (e?.code === '25006' || /read-only transaction/.test(message)) {
    return new GestureError(`read_only: ${message}`, { code: 'read_only' });
  }
  if (e?.code === '42501' && refusalCode(message) === undefined) {
    return new GestureError(`not_allowed: ${message}`, { code: 'not_allowed' });
  }
  return new GestureError(message);
}
