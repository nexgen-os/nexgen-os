// The runner of external engines (decision 0013), against a fake engine
// written in Node: the envelope goes in on stdin, the answer comes back on
// stdout, and every failure is a named error.
import { describe, expect, it } from 'vitest';
import { describeEngine, engineCommand, runEngine } from '../engines/runner.js';
import { repoRoot } from './helpers/db.js';

const fake = (mode: string) => [process.execPath, `${repoRoot}/tests/fixtures/engines/fake.mjs`, mode];

describe('the engine runner', () => {
  it('sends the envelope on stdin and returns the version, the result and the log', async () => {
    const answer = await runEngine<{ kind: string; n: number }, { echoed: unknown }>({ name: 'fake', command: fake('echo') }, { kind: 'echo', n: 1 });
    expect(answer.version).toBe('fake 1.0.0');
    expect(answer.result).toEqual({ echoed: { kind: 'echo', n: 1 } });
    // The engine's own log, then its stderr.
    expect(answer.log).toEqual(['one line', 'stderr: echoing']);
  });

  it('describes an engine: its version, its dependencies and the request kinds it accepts', async () => {
    const description = await describeEngine({ name: 'fake', command: fake('echo') });
    expect(description).toEqual({ engine: 'fake', version: 'fake 1.0.0', dependencies: { node: process.versions.node }, kinds: ['echo', 'pv_yield'] });
  });

  it('passes on a refusal the engine named, with its detail', async () => {
    await expect(runEngine({ name: 'fake', command: fake('error') }, { kind: 'echo' })).rejects.toThrow(/^weather_incomplete: no temperature$/);
  });

  it('engine_failed: an exit without an answer, with its code and the last lines of stderr', async () => {
    await expect(runEngine({ name: 'fake', command: fake('crash') }, { kind: 'echo' })).rejects.toThrow(/^engine_failed: fake exited with code 3; stderr: Traceback \(most recent call last\): \| KeyError: oops$/);
  });

  it('engine_timeout: an engine that does not answer in time is stopped', async () => {
    const started = Date.now();
    await expect(runEngine({ name: 'fake', command: fake('slow'), timeoutMs: 500 }, { kind: 'echo' })).rejects.toThrow(/^engine_timeout: fake gave no answer within 500 ms/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('engine_contract_mismatch: another contract version, or an answer for another engine', async () => {
    await expect(runEngine({ name: 'fake', command: fake('contract') }, { kind: 'echo' })).rejects.toThrow(/^engine_contract_mismatch: fake speaks contract 99, this runner 1/);
    await expect(runEngine({ name: 'other', command: [process.execPath, '-e', 'process.stdout.write(JSON.stringify({ engine: "fake", version: "1", contract: 1, result: {} }))'] }, {})).rejects.toThrow(
      /^engine_contract_mismatch: asked other, answered by "fake"/,
    );
    await expect(runEngine({ name: 'fake', command: [process.execPath, '-e', 'process.stdout.write("not json")'] }, {})).rejects.toThrow(/^engine_contract_mismatch: fake answered something that is not one JSON object/);
  });

  it('engine_not_found: no command, or a program that does not exist, with the line that installs it', async () => {
    const env = process.env.NEXGEN_ENGINE_NOWHERE;
    delete process.env.NEXGEN_ENGINE_NOWHERE;
    try {
      await expect(runEngine({ name: 'nowhere', install: 'pip install nowhere' }, {})).rejects.toThrow(/^engine_not_found: nowhere has no command; pip install nowhere, then give its command or set NEXGEN_ENGINE_NOWHERE$/);
    } finally {
      if (env !== undefined) process.env.NEXGEN_ENGINE_NOWHERE = env;
    }
    await expect(runEngine({ name: 'nowhere', command: ['/nonexistent/engine'] }, {})).rejects.toThrow(/^engine_not_found: nowhere could not be started \(\/nonexistent\/engine: ENOENT\); install it as engines\/nowhere\/README.md says/);
  });

  it('reads the command from NEXGEN_ENGINE_<NAME>, as words or as a JSON array; the caller\'s command wins', () => {
    expect(engineCommand({ name: 'pvlib' }, { NEXGEN_ENGINE_PVLIB: '.venv/bin/python -m nexgen_pvlib' })).toEqual(['.venv/bin/python', '-m', 'nexgen_pvlib']);
    expect(engineCommand({ name: 'pvlib' }, { NEXGEN_ENGINE_PVLIB: '["/path with space/python", "-m", "nexgen_pvlib"]' })).toEqual(['/path with space/python', '-m', 'nexgen_pvlib']);
    expect(engineCommand({ name: 'pvlib', command: ['x'] }, { NEXGEN_ENGINE_PVLIB: 'y' })).toEqual(['x']);
    expect(engineCommand({ name: 'pvlib' }, {})).toBeNull();
    expect(() => engineCommand({ name: 'pvlib' }, { NEXGEN_ENGINE_PVLIB: '[1]' })).toThrow(/engine_not_found/);
  });
});
