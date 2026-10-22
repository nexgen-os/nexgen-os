/**
 * A pack cannot execute: it holds values, units and references, and nothing
 * a program would run. The schema already refuses a field it does not name;
 * this scan covers what the schema leaves free — the value of a default may
 * be any JSON — and every string of every file.
 *
 * It looks for the shapes code takes rather than judging intent: a field
 * named after a program (`expression`, `formula`, `script`, `hook`, `sql`…),
 * a SQL statement, a dollar quote, a template placeholder, an arrow or a
 * function, a spreadsheet formula. A pack never needs any of them, so the
 * check refuses them outright; a sentence of prose that happened to look like
 * one is rewritten. The compiler quotes every literal anyway — this is about
 * what a pack is, not only about what a seed could do.
 */

const PROGRAM_FIELDS = /^(expression|expr|formula|script|hook|hooks|sql|query|eval|function|lambda|handler|callback|code_block|on_[a-z_]+)$/i;

const CODE_SHAPES: [RegExp, string][] = [
  [/\$[A-Za-z_0-9]*\$/, 'a dollar quote'],
  [/\$\{|\{\{|\{%/, 'a template placeholder'],
  [/=>|\bfunction\s*\(|\beval\s*\(|\bnew\s+Function\b|<script\b/i, 'a function'],
  [/^\s*=\s*[A-Za-z(]/, 'a spreadsheet formula'],
  [
    /\b(select\s+[\s\S]+?\s+from\s+[a-z_][a-z0-9_.]*\s*(;|\bwhere\b|$)|insert\s+into\s|delete\s+from\s|update\s+[a-z_.]+\s+set\s|drop\s+(table|function|schema|view)\b|create\s+(or\s+replace\s+)?(table|function|trigger|view|policy)\b|alter\s+(table|function|role)\b|truncate\s+table\b|grant\s+[a-z, ]+\s+on\s|copy\s+[a-z_.]+\s+(from|to)\s)/i,
    'a SQL statement',
  ],
  [/;\s*--|\/\*[\s\S]*\*\//, 'a SQL comment'],
];

/** Every place in a parsed JSON document that holds code, as `path: why`. */
export function executableContent(value: unknown, path = ''): string[] {
  const at = path === '' ? '(root)' : path;
  if (typeof value === 'string') {
    for (const [shape, what] of CODE_SHAPES) if (shape.test(value)) return [`${at} holds ${what}: ${value.slice(0, 60)}`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((item, i) => executableContent(item, `${path}[${i}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const where = path === '' ? key : `${path}.${key}`;
      const own = PROGRAM_FIELDS.test(key) ? [`${where} is a field for a program`] : [];
      return [...own, ...executableContent(key, `${where} (field name)`).slice(0, 1), ...executableContent(child, where)];
    });
  }
  return [];
}
