// Hygiene: the rules a reader can check without running anything.
//
//   node scripts/hygiene.mjs
//
// 1. No country, currency or language literal in code: a migration, a
//    library, a connector or a module never says 'BE', 'EUR' or 'fr' — what
//    a country decides is a pack row (examples, packs and tests are data).
// 2. No secret: nothing that looks like a key or a token in the tree.
// 3. English only in code and documentation: no French diacritics in
//    identifiers, comments or docs (examples may carry local names).
// 4. Every migration and every function sets its search path.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'assets', 'fixtures'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(root).filter((f) => /\.(sql|ts|mjs|md|json|yml)$/.test(f) && !f.endsWith('scripts/hygiene.mjs'));
const rel = (f) => relative(root, f);
// The adapter of a national register (the connectors `ban`, `geopunt`, `urbis`
// and `icar`) carries the country and the languages of its register: that is
// its data, not a default; the open geocoders and the core are held to the rule.
// A seed compiled from a pack (core/seed/<n>_pack_<cc>.sql) is the pack.
const isData = (f) => /^(examples|packs|tests)\//.test(rel(f)) || /^core\/seed\/\d+_pack_[a-z]{2}\.sql$/.test(rel(f)) || /research\//.test(rel(f)) || /^packages\/connectors\/(ban|geopunt|urbis|icar)\//.test(rel(f));

// 1. country, currency, language literals in code
const literal = /'(BE|FR|NL|DE|ES|IT|LU|SN|US|GB)'|'EUR'|'USD'|'(fr|nl|de|es)'\s*(,|\))/;
for (const f of files.filter((f) => /\.(sql|ts)$/.test(f) && !isData(f))) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('--') || line.trimStart().startsWith('//')) return;
    if (/countries|regions|iso|example|test/i.test(line)) return;
    if (literal.test(line)) problems.push(`${rel(f)}:${i + 1}: a country, currency or language literal in code: ${line.trim().slice(0, 80)}`);
  });
}

// 2. secrets
const secret = /(sk_live_|sk_test_|pk\.eyJ|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|xox[bp]-[0-9A-Za-z-]{10,})/;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const m = secret.exec(text);
  if (m) problems.push(`${rel(f)}: looks like a secret: ${m[0].slice(0, 12)}…`);
}

// 3. English only in code and documentation
const diacritics = /[àâäéèêëîïôöùûüç]/i;
for (const f of files.filter((f) => /\.(sql|ts|mjs|md)$/.test(f) && !isData(f) && !/^docs\/research\//.test(rel(f)))) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (diacritics.test(line) && !/©|Météo|Bâtiment|Référence|Découpage|Ouverte|Étude|Pérez|Faiman|Nominatim|façade|Façade|OÜ|Brussel|Bruxelles|Liège|Genève|Zürich|Lambert|Amersfoort|Frétin|Saint|Ixelles|El|Via|Rue|Avenue|Straße|Straat/.test(line)) {
      problems.push(`${rel(f)}:${i + 1}: not English: ${line.trim().slice(0, 80)}`);
    }
  });
}

// 4. search path in migrations and functions
for (const f of files.filter((f) => /migrations\/.*\.sql$/.test(f) || /seed\/.*\.sql$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  if (!/^set search_path = nexgen, public, extensions;/m.test(text)) problems.push(`${rel(f)}: no session search path`);
  const functions = text.match(/create (?:or replace )?(?:function|procedure)[\s\S]*?\nas \$\$/g) ?? [];
  for (const fn of functions) {
    if (!/set search_path = nexgen, public, extensions, pg_temp/.test(fn)) {
      problems.push(`${rel(f)}: a function without its search path: ${fn.split('\n')[0].slice(0, 80)}`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} hygiene problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`hygiene: ${files.length} files, nothing to report`);
