/**
 * What a tool is here: a name, words for a model, an input schema, and a
 * gesture of `@nexgen-os/core` run in one transaction acting as the person.
 *
 * Tools never see a connection. They are handed a `Db` that row level
 * security binds as the person (`personSession()`), and the options the
 * person configured: their geocoder, the computations of the modules.
 */
import type { Computations, Db, Geocoder } from '@nexgen-os/core';
import type { z } from 'zod';

export interface ToolContext {
  db: Db;
  computations: Computations;
  geocoder?: Geocoder | undefined;
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** Writes: refused by the database on a connection that reads. */
  writes: boolean;
  /** Changes what was there rather than adding: a client may ask before calling it. */
  destructive?: boolean;
  /** The module whose installation the tool needs; the core's otherwise. */
  module?: string;
  run(context: ToolContext, args: z.infer<S>): Promise<unknown>;
}

/** Declares a tool with its arguments typed from its schema. */
export function tool<S extends z.ZodObject>(definition: Tool<S>): Tool {
  return definition as unknown as Tool;
}
