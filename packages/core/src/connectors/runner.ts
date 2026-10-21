// The runner of the program connectors (decision 0013).
//
// A program connector is a program in any language that reads one request
// as JSON on stdin and answers one result as JSON on stdout; stderr is its
// log. It is the engine of the runs it computes, and the contract names it
// by that word (`engine`, `NEXGEN_ENGINE_<NAME>`, the `engine_*` refusals). The
// runner sends the envelope, waits for the answer, checks the contract and
// turns every failure into a named error. It never reads the database and
// never guesses a command: the caller gives it, or the environment variable
// `NEXGEN_ENGINE_<NAME>` does.

import { spawn } from 'node:child_process';

/** The version of the contract this runner speaks. */
export const ENGINE_CONTRACT = 1;

const DEFAULT_TIMEOUT_MS = 120_000;
/** Lines of stderr quoted in an `engine_failed` error. */
const STDERR_TAIL = 10;

export interface EngineSpec {
  /** The engine's name, lower case: `pvlib`, `pandapower`. */
  name: string;
  /** The program and its arguments. Default: `NEXGEN_ENGINE_<NAME>`. */
  command?: string[];
  /** Default 120 s. */
  timeoutMs?: number;
  /** The line that installs the engine, quoted when it cannot be found. */
  install?: string;
}

export interface EngineAnswer<TResult> {
  /** What the engine says it is, e.g. `pvlib 0.16.1`: the string a run records. */
  version: string;
  result: TResult;
  /** The engine's own log, then its stderr lines. */
  log: string[];
}

/** What an engine says about itself when asked `{ describe: true }`. */
export interface EngineDescription {
  engine: string;
  version: string;
  /** Main dependencies and their versions, e.g. `{ python: '3.12.4', pandas: '2.2.3' }`. */
  dependencies: Record<string, string>;
  /** The request kinds it accepts, e.g. `['pv_yield']`. */
  kinds: string[];
}

// Labels an engine of an earlier release used for units of the `units`
// vocabulary: ASCII spellings of the symbols `W/m²` and `°C`.
const ENGINE_UNIT_LABELS: Record<string, string> = { 'W/m2': 'W/m²', degC: '°C' };

/**
 * The unit of an engine's values, as the `units` vocabulary spells it (a
 * code or a symbol: `kWh`, `W/m²`, `°C`). An engine's answer names its
 * unit; `store()` converts the values to the quantity's own, and refuses by
 * name (`unit_unknown`) a label the vocabulary does not hold.
 */
export function engineUnit(label: string | undefined): string | undefined {
  return label === undefined ? undefined : (ENGINE_UNIT_LABELS[label] ?? label);
}

/**
 * The command of an engine: the caller's, or the environment variable
 * `NEXGEN_ENGINE_<NAME>` read as a JSON array of strings or as words
 * separated by spaces. Null when neither is given.
 */
export function engineCommand(spec: Pick<EngineSpec, 'name' | 'command'>, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (spec.command && spec.command.length > 0) return spec.command;
  const raw = env[envName(spec.name)]?.trim();
  if (!raw) return null;
  if (raw.startsWith('[')) {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((p) => typeof p === 'string')) {
      throw new Error(`engine_not_found: ${envName(spec.name)} is not a JSON array of strings`);
    }
    return parsed;
  }
  return raw.split(/\s+/);
}

/** `NEXGEN_ENGINE_PVLIB` for `pvlib`. */
export function envName(name: string): string {
  return `NEXGEN_ENGINE_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/** Sends one request to an engine and returns its checked answer. */
export async function runEngine<TRequest, TResult>(spec: EngineSpec, request: TRequest): Promise<EngineAnswer<TResult>> {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) throw new Error(`engine_not_found: ${JSON.stringify(spec.name)} is not an engine name`);
  const command = engineCommand(spec);
  if (!command) throw new Error(`engine_not_found: ${spec.name} has no command; ${installHint(spec)}`);

  const envelope = JSON.stringify({ engine: spec.name, contract: ENGINE_CONTRACT, request });
  const { code, stdout, stderr, timedOut, spawnError } = await exchange(command, envelope, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const stderrLines = stderr.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');

  if (spawnError) {
    if (spawnError.code === 'ENOENT' || spawnError.code === 'EACCES') {
      throw new Error(`engine_not_found: ${spec.name} could not be started (${command[0]}: ${spawnError.code}); ${installHint(spec)}`);
    }
    throw new Error(`engine_failed: ${spec.name} could not be started: ${spawnError.message}`);
  }
  if (timedOut) throw new Error(`engine_timeout: ${spec.name} gave no answer within ${spec.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`);

  const answer = parseAnswer(stdout);
  if (code !== 0) {
    // A refusal by name: the engine's own error, as it named it.
    if (answer && typeof answer.error === 'string') throw new Error(`${answer.error}: ${String(answer.detail ?? '')}`);
    throw new Error(`engine_failed: ${spec.name} exited with code ${code}${stderrLines.length ? `; stderr: ${stderrLines.slice(-STDERR_TAIL).join(' | ')}` : ''}`);
  }
  if (!answer) throw new Error(`engine_contract_mismatch: ${spec.name} answered something that is not one JSON object`);
  if (answer.contract !== ENGINE_CONTRACT) {
    throw new Error(`engine_contract_mismatch: ${spec.name} speaks contract ${JSON.stringify(answer.contract)}, this runner ${ENGINE_CONTRACT}`);
  }
  if (answer.engine !== spec.name) throw new Error(`engine_contract_mismatch: asked ${spec.name}, answered by ${JSON.stringify(answer.engine)}`);
  if (typeof answer.version !== 'string' || answer.version === '') throw new Error(`engine_contract_mismatch: ${spec.name} gave no version`);
  if (!('result' in answer)) throw new Error(`engine_contract_mismatch: ${spec.name} gave no result`);
  const log = Array.isArray(answer.log) ? answer.log.map(String) : [];
  return { version: answer.version, result: answer.result as TResult, log: [...log, ...stderrLines.map((l) => `stderr: ${l}`)] };
}

/** Asks an engine what it is: its version, its dependencies, the request kinds it accepts. */
export async function describeEngine(spec: EngineSpec): Promise<EngineDescription> {
  const { version, result } = await runEngine<{ describe: true }, Partial<EngineDescription>>(spec, { describe: true });
  if (!result || !Array.isArray(result.kinds)) throw new Error(`engine_contract_mismatch: ${spec.name} answered describe without its request kinds`);
  return { engine: spec.name, version, dependencies: result.dependencies ?? {}, kinds: result.kinds };
}

function installHint(spec: EngineSpec): string {
  const how = spec.install ?? `install it as packages/connectors/${spec.name}/README.md says`;
  return `${how}, then give its command or set ${envName(spec.name)}`;
}

interface Answer {
  engine?: unknown;
  version?: unknown;
  contract?: unknown;
  result?: unknown;
  log?: unknown;
  error?: unknown;
  detail?: unknown;
}

function parseAnswer(stdout: string): Answer | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Answer) : null;
  } catch {
    return null;
  }
}

function exchange(
  command: string[],
  input: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError: NodeJS.ErrnoException | null }> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e;
    });
    // An engine that exits before reading all of stdin closes the pipe: not an error of the runner's.
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, spawnError });
    });
    child.stdin.end(input, 'utf8');
  });
}
