/**
 * The server before anybody has told it where the database is.
 *
 * A client lists a server's tools the moment it is added, and so do the
 * directories that index servers. So when the connection is simply absent
 * the server starts anyway, and every call answers with what to set.
 * Nothing is connected and nothing is guessed.
 */
import { GestureError, type Session } from '@nexgen-os/core';
import { ENV } from './config.js';

const ABSENT = ['missing_configuration', 'missing_credentials'] as const;

/** Whether a configuration error only says that something is missing. */
export function isMissingConfiguration(error: unknown): boolean {
  return error instanceof GestureError && ABSENT.some((code) => error.message.startsWith(`${code}:`));
}

const HINT =
  `Add the variables to the "env" block of this server in the client's configuration, then restart the client: ${ENV.dbUrl}, and ` +
  `${ENV.apiKey} (a key an owner issued with nexgen-os key create), ${ENV.accessToken} with ${ENV.supabaseUrl} and ${ENV.anonKey}, or ${ENV.actAsUserId}. ` +
  `${ENV.write}=1 lets it write. No database yet: npx nexgen-os init installs one. Tell the person this; do not retry the call.`;

export function unconfiguredSession(reason: Error): Session {
  return {
    actingAs: 'nobody',
    writable: false,
    run: () => Promise.reject(new GestureError(`not_configured: this server has no connection to a Nexgen OS database yet. ${reason.message}`, { code: 'not_configured', hint: HINT })),
    close: () => Promise.resolve(),
  };
}
