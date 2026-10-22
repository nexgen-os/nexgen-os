/**
 * Where the server gets its connection and who it acts as, and what it
 * refuses: the rules of every surface (`@nexgen-os/core`, `surface.ts`),
 * spoken as "this server".
 */
import { IDENTITY_ENV, readSurfaceConfig, refuseServiceRole as refuse, type SurfaceConfig } from '@nexgen-os/core';

export { scopesOf, verifyAccessToken } from '@nexgen-os/core';
export const ENV = IDENTITY_ENV;
export type Config = SurfaceConfig;

const SURFACE = 'this server';

/** Refuses a `service_role` key wherever it was put, before anything connects. */
export const refuseServiceRole = (env: NodeJS.ProcessEnv): void => refuse(env, SURFACE);

/** Reads the environment, and says what is missing rather than failing later. */
export const readConfig = (env: NodeJS.ProcessEnv = process.env): Config => readSurfaceConfig(env, SURFACE);
