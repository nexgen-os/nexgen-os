// A refusal, named: a gesture, a connector or the database raises with a
// name first (`mandate_missing: …`, `time_zone_required: …`, decision 0038),
// and `GestureError` carries that name and the sentence that explains it.
// The core reads the database's refusals with `explain()` and re-exports
// these, one class for every surface.

/** The name of a raise like `time_zone_required: the participant …`, or undefined. */
export function refusalCode(message: string): string | undefined {
  const match = /^([a-z][a-z0-9_]{3,}):/.exec(message.trim());
  return match?.[1];
}

/** What a few refusals mean, for whoever reads them next. An unknown name keeps its message. */
const HINTS: Record<string, string> = {
  read_only: 'This connection reads. Writing is allowed by the person: NEXGEN_WRITE=1 in the environment they wrote, a key with write, or the scope energy.write on the connection they approved.',
  not_allowed: 'The person this acts as does not hold that right. Ask them, or an owner of the organisation.',
  api_key_revoked: 'The key was withdrawn. Its owner issues another one.',
  api_key_expired: 'The key expired. Its owner issues another one.',
  api_key_unknown: 'The key was not issued by this installation. Check the variable it was put in.',
  api_key_issuer_left: 'The person who issued the key left the organisation. An owner issues another one.',
  time_zone_required: 'The participant has no time zone: give it one before reading or storing daily values.',
  geocoder_not_configured: 'No geocoder was configured by the person. Give the place as a point, or ask them to configure one.',
  module_not_installed: 'The module is not installed on this database: nexgen-os init --modules adds it.',
  computation_not_loaded: 'This server was started without the code of the module that computes this. Start it from a checkout of the repository, where the modules are.',
};

/** An error of a gesture: its name, its message, and the sentence that explains it when there is one. */
export class GestureError extends Error {
  readonly code: string | undefined;
  readonly hint: string | undefined;
  constructor(message: string, options: { code?: string; hint?: string } = {}) {
    super(message);
    this.name = 'GestureError';
    this.code = options.code ?? refusalCode(message);
    this.hint = options.hint ?? (this.code === undefined ? undefined : HINTS[this.code]);
  }
}
