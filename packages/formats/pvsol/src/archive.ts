// What a .pvprj file is made of: a ZIP archive whose entry names may use
// Windows separators (`Results\SimResults.xml`), holding XML documents and
// JSON files. A format library of Nexgen OS depends on nothing, so the
// container and the documents are read here with what Node gives: the ZIP
// directory walked by hand, its entries inflated by `node:zlib`, and the XML
// read into a tree of `{ name, children, text }`, namespace prefixes and
// attributes left aside, since PV*SOL says everything in elements.

import { inflateRawSync } from 'node:zlib';

/** The entries of a ZIP archive by their base name in lower case, inflated on demand. */
export function zipEntries(bytes: Uint8Array): Map<string, { name: string; read: () => Buffer }> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('pvsol_unreadable: not a ZIP archive, so not a PV*SOL study');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, { name: string; read: () => Buffer }>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error('pvsol_unreadable: the ZIP directory is damaged');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    const read = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`pvsol_unreadable: ${name} is compressed by method ${method}`);
    };
    if (!name.endsWith('/')) entries.set(name.slice(name.lastIndexOf('/') + 1).toLowerCase(), { name, read });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export interface XmlNode {
  /** The local name, its namespace prefix removed. */
  name: string;
  children: XmlNode[];
  /** The text of this element itself, not of its children. */
  text: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const ref = e.toLowerCase();
    if (NAMED[ref]) return NAMED[ref]!;
    return String.fromCodePoint(ref.startsWith('#x') ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
  });
}

/** The root element of a document; throws `pvsol_unreadable: …` when the document is not well formed. */
export function parseXml(xml: string, file: string): XmlNode {
  const unreadable = (what: string) => new Error(`pvsol_unreadable: ${file} holds ${what}`);
  const root: XmlNode = { name: '#document', children: [], text: '' };
  const stack: XmlNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) { top().text += decode(xml.slice(i)); break; }
    if (lt > i) top().text += decode(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt) || xml.startsWith('<?', lt)) {
      const close = xml.startsWith('<!--', lt) ? '-->' : '?>';
      const end = xml.indexOf(close, lt);
      if (end === -1) throw unreadable('an unterminated comment or declaration');
      i = end + close.length;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end === -1) throw unreadable('an unterminated CDATA section');
      top().text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<!', lt)) {
      throw unreadable('a DTD');
    } else {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw unreadable('an unterminated tag');
      const tag = xml.slice(lt + 1, end);
      const qualified = /^\/?\s*([^\s/>]+)/.exec(tag)?.[1];
      if (!qualified) throw unreadable(`an invalid tag at offset ${lt}`);
      const name = qualified.slice(qualified.indexOf(':') + 1);
      if (tag.startsWith('/')) {
        const open = stack.pop();
        if (!open || open === root || open.name !== name) throw unreadable(`an unexpected </${name}>`);
      } else {
        const node: XmlNode = { name, children: [], text: '' };
        top().children.push(node);
        if (!tag.endsWith('/')) stack.push(node);
      }
      i = end + 1;
    }
  }
  if (stack.length !== 1) throw unreadable(`an unclosed <${top().name}>`);
  const element = root.children[0];
  if (!element) throw unreadable('no element');
  return element;
}

/** The first child of that name, or null. */
export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  return node?.children.find((c) => c.name === name) ?? null;
}

/** Every child of that name, in document order. */
export function children(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

/** The trimmed text of a child, written `<Tag>…</Tag>` or `<Tag><Value>…</Value></Tag>`; null when absent or empty. */
export function text(node: XmlNode | null | undefined, name: string): string | null {
  const found = child(node, name);
  if (!found) return null;
  const value = (child(found, 'Value') ?? found).text.trim();
  return value === '' ? null : value;
}

/** The number a child holds (a decimal comma read as a point), or null. */
export function num(node: XmlNode | null | undefined, name: string): number | null {
  const raw = text(node, name);
  if (raw === null) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
