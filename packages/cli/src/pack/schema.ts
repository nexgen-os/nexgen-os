/**
 * A JSON Schema validator for the subset `packs/schema/pack.1.json` uses.
 *
 * The schema is a real draft 2020-12 document, which an editor or another
 * tool can use as it is. This program is handed a database password, and its
 * one runtime dependency is the Postgres driver, so it walks the keywords the
 * pack schema needs rather than pulling a validator in: `$ref` inside the
 * document, `type`, `enum`, `const`, `required`, `properties`,
 * `additionalProperties`, `items`, `minItems`, `uniqueItems`, `minLength`,
 * `pattern`, `minimum`, `maximum` and `format: date`. A keyword this walker
 * does not know is refused when the schema is read (`unsupportedKeywords`),
 * so a schema cannot claim a check that never runs.
 */

export interface Issue {
  /** Where in the document: `defaults[2].unit`, `(root)`. */
  path: string;
  /** The keyword that failed: `required`, `type`, `pattern`… */
  keyword: string;
  message: string;
  /** For `required` and `additionalProperties`: the field in question. */
  field?: string;
}

export type Schema = Record<string, unknown>;

const KNOWN = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description',
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'uniqueItems', 'minLength', 'pattern', 'minimum', 'maximum', 'format',
]);

/** Every keyword of a schema this validator would ignore, with its path. Empty means every check runs. */
export function unsupportedKeywords(schema: unknown, path = '#'): string[] {
  if (!isObject(schema)) return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(schema)) {
    if (!KNOWN.has(key)) found.push(`${path}/${key}`);
    if (key === 'properties' || key === '$defs') {
      if (isObject(child)) for (const [name, sub] of Object.entries(child)) found.push(...unsupportedKeywords(sub, `${path}/${key}/${name}`));
    } else if (key === 'items' || key === 'additionalProperties') {
      found.push(...unsupportedKeywords(child, `${path}/${key}`));
    }
  }
  return found;
}

/** Every way `value` fails `schema`. Empty means valid. */
export function validate(value: unknown, schema: Schema, root: Schema = schema, path = ''): Issue[] {
  const s = typeof schema.$ref === 'string' ? deref(schema.$ref, root) : schema;
  const at = path === '' ? '(root)' : path;
  const issues: Issue[] = [];
  const fail = (keyword: string, message: string, field?: string) => issues.push({ path: at, keyword, message, ...(field ? { field } : {}) });

  if (s.type !== undefined) {
    const types = (Array.isArray(s.type) ? s.type : [s.type]).map(String);
    if (!types.some((t) => isType(value, t))) {
      fail('type', `expected ${types.join(' or ')}, got ${kindOf(value)}`);
      return issues;
    }
  }
  if (Array.isArray(s.enum) && !s.enum.some((option) => same(option, value))) {
    fail('enum', `not one of ${s.enum.map((o) => JSON.stringify(o)).join(', ')}`);
  }
  if ('const' in s && !same(s.const, value)) fail('const', `must be ${JSON.stringify(s.const)}`);

  if (typeof value === 'string') {
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(value)) fail('pattern', `does not match ${s.pattern}`);
    if (typeof s.minLength === 'number' && value.length < s.minLength) fail('minLength', `shorter than ${s.minLength} character(s)`);
    if (s.format === 'date' && !isDate(value)) fail('format', 'not a calendar day YYYY-MM-DD');
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) fail('minimum', `below ${s.minimum}`);
    if (typeof s.maximum === 'number' && value > s.maximum) fail('maximum', `above ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) fail('minItems', `needs at least ${s.minItems} item(s)`);
    if (s.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('uniqueItems', 'holds the same item twice');
    if (isObject(s.items)) value.forEach((item, i) => issues.push(...validate(item, s.items as Schema, root, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    if (Array.isArray(s.required)) {
      for (const name of s.required.map(String)) if (!(name in value)) fail('required', `missing "${name}"`, name);
    }
    const properties = isObject(s.properties) ? s.properties : {};
    for (const [name, child] of Object.entries(value)) {
      const sub = properties[name];
      const where = path === '' ? name : `${path}.${name}`;
      if (isObject(sub)) issues.push(...validate(child, sub, root, where));
      else if (s.additionalProperties === false) fail('additionalProperties', `unknown field "${name}"`, name);
      else if (isObject(s.additionalProperties)) issues.push(...validate(child, s.additionalProperties, root, where));
    }
  }
  return issues;
}

/** The schema a JSON pointer inside `root` names: `#/$defs/default`. */
export function deref(pointer: string, root: Schema): Schema {
  if (!pointer.startsWith('#/')) throw new Error(`pack_schema: only a local $ref is supported, got ${pointer}`);
  let node: unknown = root;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) || !(key in node)) throw new Error(`pack_schema: $ref ${pointer} points at nothing`);
    node = node[key];
  }
  if (!isObject(node)) throw new Error(`pack_schema: $ref ${pointer} is not a schema`);
  return node;
}

/** A real calendar day written YYYY-MM-DD: 2026-02-30 is not one. */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

function isType(value: unknown, name: string): boolean {
  switch (name) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'null': return value === null;
    default: return false;
  }
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
