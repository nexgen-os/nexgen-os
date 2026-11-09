// Writes src/models.ts from the JSON model definitions the SunSpec Alliance
// publishes in https://github.com/sunspec/models (Apache-2.0, see NOTICE).
//
//   git clone --depth 1 https://github.com/sunspec/models.git /tmp/sunspec-models
//   node packages/formats/sunspec/scripts/models.mjs /tmp/sunspec-models
//
// Every model of `json/` is kept, with what reading and writing registers
// needs: names, types, sizes, scale factors, units, access, counts, labels
// and the names of the symbols. Descriptions, details, comments and the
// standards a point answers stay in the published files.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/models.mjs <checkout of sunspec/models>');
  process.exit(1);
}

const POINT_KEYS = ['name', 'type', 'size', 'sf', 'units', 'access', 'mandatory', 'static', 'value', 'count', 'label', 'symbols'];

const point = (p) => {
  const o = {};
  for (const k of POINT_KEYS) if (p[k] !== undefined) o[k] = p[k];
  if (o.symbols) o.symbols = o.symbols.map((s) => ({ name: s.name, value: s.value }));
  return o;
};

const group = (g) => {
  const o = { name: g.name, type: g.type };
  if (g.count !== undefined) o.count = g.count;
  if (g.label !== undefined) o.label = g.label;
  o.points = (g.points ?? []).map(point);
  if (g.groups?.length) o.groups = g.groups.map(group);
  return o;
};

const dir = join(source, 'json');
const models = readdirSync(dir)
  .filter((f) => /^model_\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .sort((a, b) => a.id - b.id)
  .map((m) => ({ id: m.id, group: group(m.group) }));

const commit = execFileSync('git', ['-C', source, 'log', '-1', '--format=%H %cs'], { encoding: 'utf8' }).trim();

writeFileSync(
  new URL('../src/models.ts', import.meta.url),
  [
    '// The SunSpec information models, from the JSON definitions the SunSpec',
    '// Alliance publishes in https://github.com/sunspec/models under the Apache',
    '// License 2.0 (LICENSE-models, NOTICE). Written by scripts/models.mjs from',
    `// commit ${commit}; do not edit by hand.`,
    '',
    "import type { ModelDefinition } from './index.js';",
    '',
    `export const MODELS: readonly ModelDefinition[] = ${JSON.stringify(models)};`,
    '',
  ].join('\n'),
);
console.log(`${models.length} models from ${commit}`);
