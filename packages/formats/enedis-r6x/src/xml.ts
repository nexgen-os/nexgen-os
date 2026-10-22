// A small XML reader: the R6X files in XML and the SOAP answers of the
// operator's web services are small, well-formed documents written by one
// server. A tree of `{ name, attributes, children, text }` with namespace
// prefixes removed is all a reader of them needs, and keeps this library
// free of dependencies.
//
// Read: elements, attributes, text, CDATA, comments, the XML declaration,
// processing instructions, the five predefined entities and numeric ones.
// Refused: DTDs and entities of their own (`xml_unreadable`).

export interface XmlNode {
  /** The local name, its namespace prefix removed (`ns2:point` is `point`). */
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** The text of this element itself, not of its children. */
  text: string;
}

const localName = (qualified: string) => qualified.slice(qualified.indexOf(':') + 1);

/** The text with the predefined and numeric entities replaced. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const e = entity.toLowerCase();
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[e]) return named[e]!;
    return String.fromCodePoint(e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/** The text escaped for an element or an attribute. */
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** The root element of a document; throws `xml_unreadable: …` when it is not one. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#document', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top().text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      i = after(xml, '-->', lt, 'a comment');
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end === -1) throw unreadable('an unterminated CDATA section');
      top().text += xml.slice(lt + 9, end);
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      i = after(xml, '?>', lt, 'a processing instruction');
    } else if (xml.startsWith('<!', lt)) {
      throw unreadable('a DTD');
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw unreadable('an unterminated closing tag');
      const name = localName(xml.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw unreadable(`an unexpected </${name}>`);
      i = end + 1;
    } else {
      const end = tagEnd(xml, lt);
      const selfClosing = xml[end - 1] === '/';
      const inner = xml.slice(lt + 1, selfClosing ? end - 1 : end);
      const match = /^[^\s/>]+/.exec(inner);
      if (!match) throw unreadable(`an invalid tag at offset ${lt}`);
      const node: XmlNode = { name: localName(match[0]), attributes: attributes(inner.slice(match[0].length)), children: [], text: '' };
      top().children.push(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
    }
  }
  if (stack.length !== 1) throw unreadable(`an unclosed <${top().name}>`);
  const element = root.children[0];
  if (!element) throw unreadable('an empty document');
  return element;
}

/** The first element of that local name, the node itself included, depth first. */
export function findFirst(node: XmlNode, name: string): XmlNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return null;
}

/** Every element of that local name below the node, in document order. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    if (n.name === name) out.push(n);
    n.children.forEach(walk);
  };
  node.children.forEach(walk);
  return out;
}

/** The trimmed text of the first child of that local name, null when absent or empty. */
export function childText(node: XmlNode, name: string): string | null {
  const value = node.children.find((c) => c.name === name)?.text.trim();
  return value ? value : null;
}

function after(xml: string, close: string, from: number, what: string): number {
  const end = xml.indexOf(close, from);
  if (end === -1) throw unreadable(`an unterminated ${what}`);
  return end + close.length;
}

function tagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let j = from + 1; j < xml.length; j++) {
    const c = xml[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    }
  }
  throw unreadable('an unterminated start tag');
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

function unreadable(what: string): Error {
  return new Error(`xml_unreadable: ${what}`);
}
