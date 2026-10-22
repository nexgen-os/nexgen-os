/**
 * The compiler: a pack in, one seed file out.
 *
 * The SQL is a build artefact. The pack is the source; the seed is committed
 * so that the installer, `psql` or any other client applies a country without
 * this compiler, and `nexgen-os pack check` refuses a seed that is no longer
 * the exact output of its pack. Rows are sorted here, so the same pack always
 * compiles to the same bytes.
 *
 * Every statement upserts by natural key, so the file can be applied again
 * and a new version of a pack reaches an installation that holds an older
 * one. A vocabulary row (a source, an id scheme, an operator, a region) is
 * updated only where this pack published it. A value is dated and never
 * edited: the database refuses a seed whose value for a property, a region
 * and a `valid_from` differs from the one it holds (`value_edited`), and a
 * conflict only closes a period or corrects a citation. Nothing is deleted.
 *
 * The tables are those of the 0.2 core — `countries`, `regions`, `defaults`,
 * beside `sources` and `id_schemes` — and the operator table of the `grid`
 * module. Literals are quoted here and nowhere else; a pack holds no code
 * (see executable.ts), and the compiler would not run it if it did.
 */
import { valuesOf } from './check.js';
import { seedPath, type Pack, type PackDefault, type Region } from './read.js';

/** The dollar quote of the one block of the seed; a literal holding it is refused. */
const QUOTE = '$seed$';

export function compilePack(pack: Pack): string {
  const { manifest } = pack;
  const cc = manifest.country;
  const by = `pack:${pack.slug}`;
  const out: string[] = [...header(pack), 'set search_path = nexgen, public, extensions;', ''];

  if (pack.sources.length > 0) {
    out.push(
      `-- sources: ${pack.sources.length}. The registers, services and texts the country's data and values come from.`,
      ...upsert(
        'sources',
        ['code', 'name', 'description', 'kind', 'base_url', 'docs_url', 'auth', 'countries', 'regions', 'license', 'attribution', 'retention_days', 'redistributable', 'published_by'],
        byCode(pack.sources).map((s) => [
          text(s.code), text(s.name), text(s.description), text(s.kind), text(s.url), text(s.docs_url), text(s.auth ?? 'none'),
          array([cc]), array(s.regions ?? []), text(s.license), text(s.attribution), int(s.retention_days), bool(s.redistributable), text(by),
        ]),
        ['code'],
        'sources',
      ),
    );
  }

  if (pack.identifiers.length > 0) {
    out.push(
      `-- id_schemes: ${pack.identifiers.length}. The identifiers the country issues; a value of external_ids or meters matches the pattern.`,
      ...upsert(
        'id_schemes',
        ['code', 'name', 'description', 'pattern', 'url_template', 'source_code', 'published_by'],
        byCode(pack.identifiers).map((i) => [text(i.code), text(i.name), text(i.description), text(i.pattern), text(i.url_template), text(i.source_code), text(by)]),
        ['code'],
        'id_schemes',
      ),
    );
  }

  const identity = manifest.identity;
  out.push(
    '-- countries: who the country is, and which version of its pack this installation holds.',
    ...upsert(
      'countries',
      ['code', 'name', 'currency', 'languages', 'time_zones', 'region_level', 'postal_code_pattern', 'municipality_scheme',
        'pack_version', 'pack_checksum', 'published_by'],
      [[
        text(cc), text(manifest.name), text(identity.currency), array(identity.languages), array(identity.time_zones), text(identity.region_level),
        text(identity.postal_code_pattern), text(identity.municipality_scheme),
        text(manifest.version), text(pack.checksum), text(by),
      ]],
      ['code'],
      null,
    ),
  );

  if (identity.regions.length > 0) {
    out.push(
      `-- regions: ${identity.regions.length} at the level ${identity.region_level} and above, parents first.`,
      ...upsert(
        'regions',
        ['code', 'country', 'name', 'parent', 'time_zone', 'published_by'],
        parentsFirst(identity.regions).map((r) => [text(r.code), text(cc), text(r.name), text(r.parent), text(r.time_zone), text(by)]),
        ['code'],
        'regions',
      ),
    );
  }

  const operators = pack.grid?.operators ?? [];
  if (operators.length > 0) {
    out.push(
      `-- grid.operators: ${operators.length}. Who runs the grid, where, and which metering identifier they issue.`,
      ...upsert(
        'grid.operators',
        ['code', 'name', 'kind', 'country', 'regions', 'coverage', 'website', 'data_hub_url', 'identifier_scheme', 'description', 'published_by'],
        byCode(operators).map((o) => [
          text(o.code), text(o.name), text(o.kind), text(cc), array(o.regions ?? []), text(o.coverage), text(o.website),
          text(o.data_hub_url), text(o.identifier_scheme), text(o.description), text(by),
        ]),
        ['code'],
        'operators',
      ),
    );
  }

  const values = sortValues(valuesOf(pack));
  if (values.length > 0) out.push(...defaultsBlock(values, cc, by));

  return `${out.join('\n')}\n`;
}

function header(pack: Pack): string[] {
  const { manifest } = pack;
  const cert = manifest.certification;
  return [
    `-- Nexgen OS — country pack ${manifest.country} (${manifest.name}), version ${manifest.version}.`,
    '--',
    `-- Generated by \`nexgen-os pack build ${pack.slug}\` from packs/${pack.slug}/: ${pack.files.join(', ')}.`,
    '-- Do not edit: change the pack and build again. `nexgen-os pack check --all`',
    '-- refuses a seed that is not the exact output of its pack.',
    '--',
    `-- file           ${seedPath(manifest)}`,
    `-- checksum       ${pack.checksum}`,
    `-- certification  ${cert.status}${cert.reviewer ? `, ${cert.reviewer}` : ''}${cert.date ? `, ${cert.date}` : ''}`,
    `-- schema_min     ${manifest.schema_min}`,
    `-- modules        ${(manifest.modules ?? []).join(', ') || '-'}`,
    '--',
    '-- Every row is upserted by its natural key, so the file can be applied again',
    '-- and a new version of the pack reaches an installation holding an older one.',
    '-- A vocabulary row is updated only where this pack published it. A value is',
    '-- dated and never edited: the database refuses a value that differs from the',
    '-- one it holds for the same property, region and valid_from (value_edited).',
    '-- Nothing is deleted. Apply the file in one transaction, as the installer does.',
    '',
  ];
}

/**
 * `insert … on conflict (key) do update`, every column but the key refreshed.
 * With `owner`, the update only touches a row this pack published: a code
 * another publisher holds is left as it is.
 */
function upsert(table: string, columns: string[], rows: string[][], key: string[], owner: string | null): string[] {
  const updated = columns.filter((c) => !key.includes(c) && c !== 'published_by');
  const width = Math.max(...updated.map((c) => c.length));
  const lines = [
    `insert into ${table} (${columns.join(', ')}) values`,
    ...rows.map((row, i) => `  (${row.join(', ')})${i === rows.length - 1 ? '' : ','}`),
    `on conflict (${key.join(', ')}) do update set`,
    ...updated.map((c, i) => `  ${c.padEnd(width)} = excluded.${c}${i === updated.length - 1 ? '' : ','}`),
    ...(owner === null ? [] : [`where ${owner}.published_by = excluded.published_by`]),
  ];
  lines[lines.length - 1] += ';';
  return [...lines, ''];
}

/**
 * The values, in one block: refused by name before anything is written when
 * a property is unknown, a unit is not the property's, or a value already
 * held differs; otherwise upserted, a conflict closing a period or correcting
 * a citation and never touching the value.
 */
function defaultsBlock(values: PackDefault[], cc: string, by: string): string[] {
  const regional = values.filter((v) => v.region !== undefined).length;
  const rows = values.map(
    (v) =>
      `      (${text(v.property)}::text, ${text(v.region)}::text, ${jsonb(v.value)}, ${text(v.unit)}::text, ` +
      `${date(v.valid_from)}, ${date(v.valid_to)}, ${text(v.source_code)}::text, ${text(v.reference)}::text)`,
  );
  return [
    `-- defaults: ${values.length} value(s)${regional > 0 ? `, ${regional} of them for a region` : ''}. What parameter_of() answers`,
    '-- for a participant of the country when nothing nearer gives a value.',
    `do ${QUOTE}`,
    'declare',
    '  refused text;',
    'begin',
    '  with pack (property_code, region, value, unit, valid_from, valid_to, source_code, reference) as (',
    '    values',
    rows.join(',\n'),
    '  ),',
    '  problems (problem) as (',
    "    select format('property_unknown: %s is not a property_defs code', p.property_code)",
    '      from pack p',
    '     where not exists (select 1 from property_defs d where d.code = p.property_code)',
    '    union all',
    "    select format('unit_mismatch: %s is stored in %s and the pack says %s', p.property_code, q.unit, p.unit)",
    '      from pack p',
    '      join property_defs d on d.code = p.property_code',
    '      join quantities q on q.code = d.quantity_code',
    '     where q.unit <> p.unit',
    '    union all',
    "    select format('value_edited: %s%s from %s holds %s and the pack says %s; close it with valid_to and add a row',",
    "                  p.property_code, coalesce(' (' || p.region || ')', ''), p.valid_from,",
    "                  coalesce(x.value::text, 'null'), coalesce(p.value::text, 'null'))",
    '      from pack p',
    '      join defaults x',
    `        on x.country = ${text(cc)} and x.property_code = p.property_code`,
    '       and x.region is not distinct from p.region and x.valid_from = p.valid_from',
    '     where x.value is distinct from p.value',
    '  ),',
    '  written as (',
    '    insert into defaults (property_code, country, region, value, valid_from, valid_to, source_code, reference, published_by)',
    `    select p.property_code, ${text(cc)}, p.region, p.value, p.valid_from, p.valid_to, p.source_code, p.reference, ${text(by)}`,
    '      from pack p',
    '     where not exists (select 1 from problems)',
    '    on conflict (country, region, property_code, valid_from) do update set',
    '      valid_to    = excluded.valid_to,',
    '      source_code = excluded.source_code,',
    '      reference   = excluded.reference',
    '    returning 1',
    '  )',
    "  select string_agg(problem, '; ' order by problem) into refused from problems;",
    '  if refused is not null then',
    "    raise exception '%', refused;",
    '  end if;',
    'end',
    `${QUOTE};`,
  ];
}

function byCode<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compare(a.code, b.code));
}

/** Regions sorted by depth, then code, so that a parent exists before its children. */
function parentsFirst(regions: Region[]): Region[] {
  const parent = new Map(regions.map((r) => [r.code, r.parent]));
  const depth = (code: string, seen = new Set<string>()): number => {
    const up = parent.get(code);
    if (up === undefined || seen.has(code) || !parent.has(up)) return 0;
    seen.add(code);
    return 1 + depth(up, seen);
  };
  return [...regions].sort((a, b) => depth(a.code) - depth(b.code) || compare(a.code, b.code));
}

function sortValues(values: PackDefault[]): PackDefault[] {
  return [...values].sort(
    (a, b) =>
      compare(a.property, b.property) ||
      compare(a.region ?? '', b.region ?? '') ||
      compare(a.valid_from, b.valid_from),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function text(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  if (value.includes(QUOTE)) throw new Error(`pack_executable: a literal holds ${QUOTE}`);
  return `'${value.replace(/'/g, "''")}'`;
}

function array(values: string[]): string {
  return values.length === 0 ? "'{}'::text[]" : `array[${values.map(text).join(', ')}]::text[]`;
}

function jsonb(value: unknown): string {
  return value === null || value === undefined ? 'null::jsonb' : `${text(JSON.stringify(value))}::jsonb`;
}

function date(value: string | undefined): string {
  return value === undefined ? 'null::date' : `${text(value)}::date`;
}

function int(value: number | undefined): string {
  return value === undefined ? 'null' : String(value);
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}
