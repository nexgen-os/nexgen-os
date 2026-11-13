// A project sheet kept as a workbook: the first worksheet of an Office Open
// XML spreadsheet (.xlsx, ECMA-376 / ISO/IEC 29500, as Excel, LibreOffice
// and the others save it) read into the same rows a CSV gives, so that the
// person who keeps the sheet need not export it.
//
// A cell gives its text as the workbook holds it: a shared or inline string
// as written, a number in its shortest decimal form, a boolean as TRUE or
// FALSE. A number shown as a date — a built-in date format or a format of
// its own made of days, months and years — is the day it counts from the
// workbook's epoch (1900, or 1904 when the workbook says so), YYYY-MM-DD.
// A number of more than fifteen digits has been rounded by the spreadsheet
// (an identifier typed as a number): it is reported as `number_rounded`,
// never given as it is.
//
// Only what Node gives is used: the ZIP container is read here and its
// entries inflated by `node:zlib`.
import { inflateRawSync } from 'node:zlib';
import { projectsOfRows, reportTo, type ProjectSheet, type SheetProblem, type SheetRow } from './index.js';

/** The entries of a ZIP archive by name, inflated on demand. */
function zipEntries(bytes: Uint8Array): Map<string, () => Buffer> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('workbook_unreadable: not a ZIP archive, so not an .xlsx workbook');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('workbook_unreadable: the ZIP directory is damaged');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`workbook_unreadable: ${name} is compressed by method ${method}`);
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text of XML character data, its entities and character references resolved. */
function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') return String.fromCodePoint(ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

/** The value of an attribute of an element's opening tag. */
function attribute(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? undefined : unescape(m[1]!);
}

/** The text of the `<t>` runs of a string item, phonetic runs left out. */
function textOf(item: string): string {
  return [...item.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((m) => unescape(m[1] ?? '')).join('');
}

/** Whether a number format shows a day: built in (14 to 22, 45 to 47) or its own code made of days, months and years. */
function isDateFormat(id: number, codes: Map<number, string>): boolean {
  if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
  const code = codes.get(id);
  if (code === undefined) return false;
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dy]/i.test(bare) && !/[#0?]/.test(bare);
}

/** Column letters to their index from 0: A is 0, AA is 26. */
function columnIndex(reference: string): number {
  let n = 0;
  for (const c of reference.replace(/\d+$/, '')) n = n * 26 + (c.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
}

/** The day a serial number counts from the workbook's epoch. */
function dayOf(serial: number, epoch1904: boolean): string {
  // 1900 system: day 60 is the 29 February 1900 the format counts but which
  // never was; serials after it are one day ahead of the calendar.
  const days = Math.floor(serial) + (epoch1904 ? 1462 : serial < 60 ? 1 : 0);
  return new Date(Date.UTC(1899, 11, 30) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reads the first worksheet of an .xlsx workbook — or the one named by
 * `options.sheet` — as a project sheet: see the head of this file and of
 * `readProjectSheet()`. A file that is not a workbook throws
 * `workbook_unreadable`; a sheet that is not there, `sheet_not_found`.
 */
export function readProjectWorkbook(bytes: Uint8Array, options: { sheet?: string } = {}): ProjectSheet {
  const entries = zipEntries(bytes);
  const read = (name: string) => entries.get(name)?.().toString('utf8');
  const workbook = read('xl/workbook.xml');
  if (workbook === undefined) throw new Error('workbook_unreadable: no xl/workbook.xml, so not an .xlsx workbook');
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: attribute(m[0], 'name'), id: attribute(m[0], 'r:id') }));
  const sheet = options.sheet === undefined ? sheets[0] : sheets.find((s) => s.name === options.sheet);
  if (sheet === undefined) throw new Error(`sheet_not_found: ${options.sheet ?? 'the workbook has no sheet'}`);
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attribute(r, 'Id') === sheet.id);
  const path = target === undefined ? undefined : attribute(target, 'Target');
  const sheetXml = path === undefined ? undefined : read(path.startsWith('/') ? path.slice(1) : `xl/${path}`);
  if (sheetXml === undefined) throw new Error(`sheet_not_found: ${sheet.name ?? ''} has no worksheet part`);

  const epoch1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => textOf(m[1] ?? ''));
  const styles = read('xl/styles.xml') ?? '';
  const codes = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attribute(m[0], 'numFmtId')), attribute(m[0], 'formatCode') ?? ''] as const));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dated = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => isDateFormat(Number(attribute(m[0], 'numFmtId') ?? 0), codes));

  const problems: SheetProblem[] = [];
  const report = reportTo(problems);
  const rows: SheetRow[] = [];
  let next = 1;
  for (const r of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const line = Number(attribute(r[1]!, 'r') ?? next);
    next = line + 1;
    const cells: string[] = [];
    let column = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1]!;
      const reference = attribute(tag, 'r');
      if (reference !== undefined) column = columnIndex(reference);
      const body = c[2] ?? '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const type = attribute(tag, 't') ?? 'n';
      let text = '';
      if (type === 's') text = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') text = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'd') text = unescape(raw ?? '').slice(0, 10);
      else if (type === 'n' && raw !== undefined) {
        const value = Number(raw);
        if (dated[Number(attribute(tag, 's') ?? 0)] === true) text = dayOf(value, epoch1904);
        else if (Number.isInteger(value) && Math.abs(value) >= 1e15) report('number_rounded', line, reference, raw);
        else text = String(value);
      } else text = unescape(raw ?? '');
      cells[column] = text;
      column++;
    }
    rows.push({ line, cells: Array.from(cells, (v) => v ?? '') });
  }
  const projects = projectsOfRows(rows, false, problems);
  return { format: 'xlsx', delimiter: null, projects, problems };
}
