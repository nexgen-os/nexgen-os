// The command line from a checkout, with the computations of the modules
// shipped here, so that `size` computes: `npx tsx modules/cli.ts size …`,
// with the same environment as `npx nexgen-os`.
import { main } from '../packages/cli/src/cli.js';
import { MODULE_COMPUTATIONS } from './computations.js';

process.exitCode = await main(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  computations: MODULE_COMPUTATIONS,
});
