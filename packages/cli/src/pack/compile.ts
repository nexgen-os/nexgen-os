/**
 * The compiler: a pack in, one seed file out.
 *
 * The SQL is a build artefact. The pack is the source; the seed is committed
 * so that the installer, `psql` or any other client applies a country without
 * this compiler, and `nexgen-os pack check` refuses a seed that is not
 * the exact output of its pack. Rows are sorted here, so the same pack always
 * compiles to the same bytes.
 *
 * Every statement upserts by natural key, so the file can be applied again
 * and a new version of a pack reaches an installation that holds an older
 * one. A vocabulary row (a source, an id scheme, an operator, a region) is
 * updated only where this pack published it. A value is dated and never
 * edited: the database refuses a seed whose value for an attribute type, a region
 * and a `valid_from` differs from the one it holds (`value_edited`), and a
 * conflict only closes a period or corrects a citation. Nothing is deleted.
 *
 * The tables are those of the core — `countries`, `regions` (subdivisions,
 * then municipalities), `defaults`, beside `sources`, `identifier_schemes`
 * and `project_kinds` — and the operator table of the `grid` module. Literals are quoted here and nowhere else; a pack holds no code
 * (see executable.ts), and the compiler would not run it if it did.
 */
import { conditionOf, municipalityRegion, valuesOf } from './check.js';
import { seedPath, type Pack, type PackDefault, type Region } from './read.js';

/** The dollar quote of the one block of the seed; a literal holding it is refused. */
const QUOTE = '$seed$';

export function compilePack(pack: Pack): string {
  const { manifest } = pack;
  const cc = manifest.country;
  const by = `pack:${pack.slug}`;
  const out: string[] = [...header(pack), 'set search_path = nexgen, extensions;', ''];

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
      `-- identifier_schemes: ${pack.identifiers.length}. The identifiers the country issues; a value of identifiers or meters matches the pattern.`,
      ...upsert(
        'identifier_schemes',
        ['code', 'name', 'description', 'pattern', 'url_template', 'source_code', 'icd', 'published_by'],
        byCode(pack.identifiers).map((i) => [text(i.code), text(i.name), text(i.description), text(i.pattern), text(i.url_template), text(i.source_code), text(i.icd), text(by)]),
        ['code'],
        'identifier_schemes',
      ),
    );
  }

  const identity = manifest.identity;
  if (identity.currency_details) {
    const c = identity.currency_details;
    out.push(
      '-- currencies: the currency of the country, which the core\'s list does not hold. Never updated: the core and Ekwo OS keep one list.',
      `insert into currencies (code, name, symbol, decimal_places) values (${text(identity.currency)}, ${text(c.name)}, ${text(c.symbol)}, ${c.decimal_places})`,
      'on conflict (code) do nothing;',
      '',
    );
  }
  out.push(
    '-- countries: who the country is, and which version of its pack this installation holds.',
    ...upsert(
      'countries',
      ['code', 'name', 'currency', 'languages', 'time_zones', 'region_level', 'postal_code_pattern', 'municipality_scheme', 'bbox',
        'pack_version', 'pack_checksum', 'published_by'],
      [[
        text(cc), text(manifest.name), text(identity.currency), array(identity.languages), array(identity.time_zones), text(identity.region_level),
        text(identity.postal_code_pattern), text(identity.municipality_scheme),
        identity.bbox ? `array[${identity.bbox.map(String).join(', ')}]::double precision[]` : 'null::double precision[]',
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
        ['code', 'country', 'name', 'kind', 'parent_code', 'time_zone', 'names', 'aliases', 'postal_prefixes', 'published_by'],
        parentsFirst(identity.regions).map((r) => [
          text(r.code), text(cc), text(r.name), text('subdivision'), text(r.parent), text(r.time_zone),
          jsonb(r.names ?? {}), array(r.aliases ?? []), array(r.postal_prefixes ?? []), text(by),
        ]),
        ['code'],
        'regions',
      ),
    );
  }

  const municipalities = pack.municipalities?.municipalities ?? [];
  if (municipalities.length > 0) {
    out.push(
      `-- regions: ${municipalities.length} municipalities, each under its ${identity.region_level}, coded ${cc}-<${identity.municipality_scheme ?? 'code'}>.`,
      ...upsert(
        'regions',
        ['code', 'country', 'name', 'kind', 'parent_code', 'published_by'],
        [...municipalities]
          .sort((a, b) => compare(a.code, b.code))
          .map((m) => [text(municipalityRegion(cc, m.code)), text(cc), text(m.name), text('municipality'), text(m.parent), text(by)]),
        ['code'],
        'regions',
      ),
    );
  }

  if (pack.project_kinds.length > 0) {
    out.push(
      `-- project_kinds: ${pack.project_kinds.length}. The frames of projects the law of the country defines, each refining a kind of the core.`,
      ...upsert(
        'project_kinds',
        ['code', 'name', 'description', 'parent_code', 'country', 'source_code', 'reference', 'published_by'],
        byCode(pack.project_kinds).map((k) => [
          text(k.code), text(k.name), text(k.description), text(k.parent), text(cc), text(k.source_code), text(k.reference), text(by),
        ]),
        ['code'],
        'project_kinds',
      ),
    );
  }

  const operators = pack.grid?.operators ?? [];
  if (operators.length > 0) {
    out.push(
      `-- grid.operators: ${operators.length}. Who runs the grid, where, and which metering identifier they issue.`,
      ...upsert(
        'grid.operators',
        ['code', 'name', 'kind', 'country', 'regions', 'municipalities', 'identifier_prefixes', 'coverage', 'website', 'data_hub_url',
          'meter_data', 'identifier_scheme', 'eic_code', 'description', 'published_by'],
        byCode(operators).map((o) => [
          text(o.code), text(o.name), text(o.kind), text(cc), array(o.regions ?? []), array(o.municipalities ?? []),
          array(o.identifier_prefixes ?? []), text(o.coverage), text(o.website),
          text(o.data_hub_url), jsonb(o.meter_data ?? {}), text(o.identifier_scheme), text(o.eic_code), text(o.description), text(by),
        ]),
        ['code'],
        'operators',
      ),
    );
  }

  const schemes = pack.grid?.support_schemes ?? [];
  if (schemes.length > 0) {
    out.push(
      `-- grid.support_schemes: ${schemes.length}. Who a scheme supports, for how long, and when it stops at negative prices.`,
      ...upsert(
        'grid.support_schemes',
        ['code', 'country', 'name', 'kind', 'allocation', 'device_types', 'min_power_kw', 'max_power_kw', 'duration_years',
          'negative_price_rules', 'source_code', 'reference', 'valid_from', 'valid_to', 'published_by'],
        byCode(schemes).map((x) => [
          text(x.code), text(cc), text(x.name), text(x.kind), text(x.allocation ?? 'open_window'), array(x.device_types ?? []),
          num(x.min_power_kw), num(x.max_power_kw), int(x.duration_years), jsonb(x.negative_price_rules ?? []),
          text(x.source_code), text(x.reference), date(x.valid_from), date(x.valid_to), text(by),
        ]),
        ['code'],
        'support_schemes',
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
    '-- one it holds for the same attribute type, region and valid_from (value_edited).',
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
 * an attribute type is unknown, a unit is not the attribute type's, or a value already
 * held differs; otherwise upserted, a conflict closing a period or correcting
 * a citation and never touching the value.
 */
function defaultsBlock(values: PackDefault[], cc: string, by: string): string[] {
  const regional = values.filter((v) => v.region !== undefined).length;
  const conditional = values.filter((v) => Object.keys(v.condition ?? {}).length > 0).length;
  const rows = values.map(
    (v) =>
      `      (${text(v.attribute_type)}::text, ${text(v.region)}::text, ${jsonb(v.condition ?? {})}, ${jsonb(v.value)}, ${text(v.unit)}::text, ` +
      `${date(v.valid_from)}, ${date(v.valid_to)}, ${text(v.source_code)}::text, ${text(v.reference)}::text, ${text(v.quality ?? 'published')}::text)`,
  );
  return [
    `-- defaults: ${values.length} value(s)${regional > 0 ? `, ${regional} of them for a region or a municipality` : ''}` +
      `${conditional > 0 ? `, ${conditional} for a condition` : ''}. What parameter_of() answers`,
    '-- for a participant of the country when nothing nearer gives a value.',
    `do ${QUOTE}`,
    'declare',
    '  refused text;',
    'begin',
    '  with pack (attribute_type, region, condition, value, unit, valid_from, valid_to, source_code, reference, quality) as (',
    '    values',
    rows.join(',\n'),
    '  ),',
    '  problems (problem) as (',
    "    select format('attribute_type_unknown: %s is not an attribute_types code', p.attribute_type)",
    '      from pack p',
    '     where not exists (select 1 from attribute_types d where d.code = p.attribute_type)',
    '    union all',
    "    select format('unit_mismatch: %s is stored in %s and the pack says %s', p.attribute_type, u.unit, p.unit)",
    '      from pack p',
    '      join attribute_types d on d.code = p.attribute_type',
    '      join quantities q on q.code = d.quantity_code',
    `      cross join lateral (select quantity_unit(q.code, (select c.currency from countries c where c.code = ${text(cc)})) as unit) u`,
    '     where u.unit <> p.unit',
    '    union all',
    "    select format('value_edited: %s%s from %s holds %s and the pack says %s; close it with valid_to and add a row',",
    "                  p.attribute_type, coalesce(' (' || nullif(concat_ws(', ', p.region, nullif(p.condition, '{}')::text), '') || ')', ''), p.valid_from,",
    "                  coalesce(x.value::text, 'null'), coalesce(p.value::text, 'null'))",
    '      from pack p',
    '      join defaults x',
    `        on x.country = ${text(cc)} and x.attribute_type = p.attribute_type`,
    '       and x.region is not distinct from p.region and x.valid_from = p.valid_from',
    '       and x.condition = p.condition',
    '     where x.value is distinct from p.value',
    '  ),',
    '  written as (',
    '    insert into defaults (attribute_type, country, region, condition, value, valid_from, valid_to,',
    '                          source_code, reference, quality, published_by)',
    `    select p.attribute_type, ${text(cc)}, p.region, p.condition, p.value, p.valid_from, p.valid_to,`,
    `           p.source_code, p.reference, p.quality, ${text(by)}`,
    '      from pack p',
    '     where not exists (select 1 from problems)',
    '    on conflict (country, region, attribute_type, condition, valid_from) do update set',
    '      valid_to    = excluded.valid_to,',
    '      source_code = excluded.source_code,',
    '      reference   = excluded.reference,',
    '      quality     = excluded.quality',
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
      compare(a.attribute_type, b.attribute_type) ||
      compare(a.region ?? '', b.region ?? '') ||
      compare(conditionOf(a), conditionOf(b)) ||
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

function num(value: number | undefined): string {
  return value === undefined ? 'null' : String(value);
}

function bool(value: boolean): string {
  return value ? 'true' : 'false';
}
