// Hygiene: the rules a reader can check without running anything.
//
//   node scripts/hygiene.mjs
//
// 1. No country, currency or language literal in code: a migration, a
//    library, a connector or a module never says 'BE', 'EUR' or 'fr' — what
//    a country decides is a pack row (examples, packs and tests, those of the modules and of the format
//    libraries included, are data).
// 2. No secret: nothing that looks like a key or a token in the tree.
// 3. English only in code and documentation: no French diacritics in
//    identifiers, comments or docs (examples may carry local names).
// 4. Every migration and every function sets its search path.
// 5. A format library touches no database and nothing of Nexgen OS: no
//    import of another package of the repository, no query, no network
//    call (decision 0035).
// 6. No policy compares a role: a policy asks has_capability() or
//    row_has_capability(), and a role is resolved into capabilities by
//    role_capabilities (decision 0051). organisation_role() is for display.

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
// A seed compiled from a pack (supabase/seed/<n>_pack_<cc>.sql) is the pack.
const isData = (f) => /^(docs\/demo|packs|tests)\//.test(rel(f)) || /^(modules|packages\/formats)\/[^/]+\/tests\//.test(rel(f)) || /^supabase\/seed\/\d+_pack_[a-z]{2}\.sql$/.test(rel(f)) || /research\//.test(rel(f)) || /^packages\/connectors\/(ban|geopunt|urbis|icar)\//.test(rel(f));

// 1. country, currency, language literals in code
const literal = /'(BE|FR|NL|DE|ES|IT|LU|SN|US|GB)'|'EUR'|'USD'|'(fr|nl|de|es)'\s*(,|\))/;
for (const f of files.filter((f) => /\.(sql|ts)$/.test(f) && !isData(f))) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('--') || line.trimStart().startsWith('//')) return;
    if (/countries|regions|iso|example|test/i.test(line)) return;
    // The ISO 4217 list of the core seed is the vocabulary itself, not a default.
    if (rel(f) === 'supabase/seed/0001_core_vocabularies.sql' && /^\s*\('[A-Z]{3}', '[^']+',/.test(line)) return;
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

// 4. search path in migrations and functions: `nexgen` and the extensions,
// never `public`, which stays the installation's. The one exception is the
// billing module's readers of Ekwo OS's own tables, under Ekwo's search path.
for (const f of files.filter((f) => /migrations\/.*\.sql$/.test(f) || /seed\/.*\.sql$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  if (!/^set search_path = nexgen, extensions;/m.test(text)) problems.push(`${rel(f)}: no session search path`);
  const functions = text.match(/create (?:or replace )?(?:function|procedure)[\s\S]*?\nas \$\$/g) ?? [];
  for (const fn of functions) {
    const ekwoReader = /^modules\/billing\//.test(rel(f)) && /set search_path = public, pg_temp/.test(fn);
    if (!/set search_path = nexgen, extensions, pg_temp/.test(fn) && !ekwoReader) {
      problems.push(`${rel(f)}: a function without its search path: ${fn.split('\n')[0].slice(0, 80)}`);
    }
  }
}

// 5. format libraries
for (const f of files.filter((f) => /^packages\/formats\/[^/]+\/src\/.*\.ts$/.test(rel(f)))) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/from '(@nexgen-os\/|\.\.\/\.\.\/)/.test(line) || /\.query\s*[(<]/.test(line) || /\bfetch\s*\(/.test(line)) {
      problems.push(`${rel(f)}:${i + 1}: a format library reaches beyond its file: ${line.trim().slice(0, 80)}`);
    }
  });
}

// 6. no policy compares a role
for (const f of files.filter((f) => /migrations\/.*\.sql$/.test(f))) {
  const text = readFileSync(f, 'utf8');
  const policies = text.match(/create policy[\s\S]*?(;|',)/g) ?? [];
  for (const policy of policies) {
    if (/'{1,2}(owner|editor|viewer|participant)'{1,2}|\brole\s*(=|<>|in\s*\()|organisation_role\(|project_role\(/.test(policy)) {
      problems.push(`${rel(f)}: a policy compares a role instead of asking for a capability: ${policy.split('\n')[0].slice(0, 80)}`);
    }
  }
  text.split('\n').forEach((line, i) => {
    if (/organisation_role\(/.test(line) && !/^(create or replace function|comment on function|grant execute)|^\s*--/.test(line.trimStart())) {
      problems.push(`${rel(f)}:${i + 1}: organisation_role() is for display, a gesture asks has_capability(): ${line.trim().slice(0, 80)}`);
    }
  });
}

if (problems.length) {
  console.error(`${problems.length} hygiene problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`hygiene: ${files.length} files, nothing to report`);
