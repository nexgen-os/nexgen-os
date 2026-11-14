/**
 * The devices of a place found on its own network by DNS-based service
 * discovery over multicast DNS (DNS-SD, RFC 6763, over mDNS, RFC 6762).
 *
 * A meter dongle, a charging station, an inverter or a heat pump that
 * announces itself does so as an instance of a service type
 * (`_<service>._tcp`): its name, the host that carries it, its port, its
 * addresses and a few key=value pairs. `discover()` asks for the service
 * types it is given and gathers what answers; `matchDiscovered()` tells,
 * from a catalogue given as data, which entries each service found may be.
 *
 * No database and no dependency: the messages are read and written here,
 * and the network is reached through `node:dgram` only when `discover()`
 * is called without a transport of its own.
 */
import { createSocket } from 'node:dgram';

/** A refusal by name: `message_invalid`, `service_invalid`. */
export class MdnsError extends Error {
  constructor(
    readonly code: 'message_invalid' | 'service_invalid',
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'MdnsError';
  }
}

/** The record types DNS-SD needs, by their number in DNS. */
export const RECORD_TYPES = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 } as const;
export type RecordType = keyof typeof RECORD_TYPES;

export interface Srv {
  priority: number;
  weight: number;
  port: number;
  target: string;
}

/** One resource record of a message, of a type DNS-SD reads; the others are skipped. */
export type DnsRecord =
  | { name: string; type: 'PTR'; ttl: number; data: string }
  | { name: string; type: 'SRV'; ttl: number; data: Srv }
  | { name: string; type: 'TXT'; ttl: number; data: Record<string, string | true> }
  | { name: string; type: 'A' | 'AAAA'; ttl: number; data: string };

export interface DnsQuestion {
  name: string;
  type: RecordType;
}

export interface DnsMessage {
  /** Set on an answer (the QR bit). */
  response: boolean;
  questions: DnsQuestion[];
  /** Answers, authority and additional records together, in that order. */
  records: DnsRecord[];
}

/** One instance of a service found on the network. */
export interface DiscoveredService {
  /** The instance's own name, as people read it: `P1 meter`. */
  name: string;
  /** Its service type, without the domain: `_hwenergy._tcp`. */
  service: string;
  /** The host that carries it, without the domain: `p1meter-0a1b2c`; null when no SRV record was received. */
  host: string | null;
  port: number | null;
  /** IPv4 and IPv6 addresses of the host, as received. */
  addresses: string[];
  /** The key=value pairs of its TXT record; a key without a value is `true`. */
  txt: Record<string, string | true>;
}

const DOMAIN = 'local';
const CLASS_IN = 1;
const TYPE_BY_NUMBER = new Map<number, RecordType>(
  Object.entries(RECORD_TYPES).map(([name, n]) => [n, name as RecordType]),
);

/**
 * A service type as DNS-SD writes it, `_<service>._tcp` or `_<service>._udp`,
 * with or without `.local`; refused by name otherwise.
 */
export function serviceType(service: string): string {
  const s = service.trim().replace(/\.$/, '').replace(/\.local$/i, '');
  if (!/^_[A-Za-z0-9][A-Za-z0-9_-]*\._(tcp|udp)$/.test(s)) {
    throw new MdnsError('service_invalid', `"${service}" is not a service type such as _http._tcp`);
  }
  return s;
}

function writeName(name: string, out: number[]): void {
  for (const label of name.replace(/\.$/, '').split('.')) {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length === 0 || bytes.length > 63) {
      throw new MdnsError('message_invalid', `label "${label}" of "${name}" is empty or longer than 63 bytes`);
    }
    out.push(bytes.length, ...bytes);
  }
  out.push(0);
}

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function rdataOf(record: DnsRecord): number[] {
  const out: number[] = [];
  switch (record.type) {
    case 'PTR':
      writeName(record.data, out);
      return out;
    case 'SRV':
      out.push(...u16(record.data.priority), ...u16(record.data.weight), ...u16(record.data.port));
      writeName(record.data.target, out);
      return out;
    case 'TXT': {
      const pairs = Object.entries(record.data);
      if (pairs.length === 0) return [0];
      for (const [key, value] of pairs) {
        const bytes = Buffer.from(value === true ? key : `${key}=${value}`, 'utf8');
        if (bytes.length > 255) throw new MdnsError('message_invalid', `TXT entry "${key}" is longer than 255 bytes`);
        out.push(bytes.length, ...bytes);
      }
      return out;
    }
    case 'A': {
      const parts = record.data.split('.').map(Number);
      if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
        throw new MdnsError('message_invalid', `"${record.data}" is not an IPv4 address`);
      }
      return parts;
    }
    case 'AAAA':
      return ipv6Bytes(record.data);
  }
}

function ipv6Bytes(address: string): number[] {
  const [head, tail = null] = address.split('::');
  const groups = (s: string | null) => (s ? s.split(':') : []);
  const left = groups(head!);
  const right = tail === null ? [] : groups(tail);
  const missing = 8 - left.length - right.length;
  if ((tail === null && missing !== 0) || missing < 0) {
    throw new MdnsError('message_invalid', `"${address}" is not an IPv6 address`);
  }
  const all = [...left, ...Array<string>(missing).fill('0'), ...right];
  return all.flatMap((g) => {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) throw new MdnsError('message_invalid', `"${address}" is not an IPv6 address`);
    return u16(parseInt(g, 16));
  });
}

/**
 * A DNS message in bytes: the questions as one-shot queries (class IN, a
 * multicast answer welcome), the records as answers with the cache-flush
 * bit off. Names are written whole, never compressed.
 */
export function writeMessage(message: { response?: boolean; questions?: DnsQuestion[]; records?: DnsRecord[] }): Buffer {
  const questions = message.questions ?? [];
  const records = message.records ?? [];
  const out: number[] = [
    ...u16(0),
    ...u16(message.response ? 0x8400 : 0),
    ...u16(questions.length),
    ...u16(records.length),
    ...u16(0),
    ...u16(0),
  ];
  for (const q of questions) {
    writeName(q.name, out);
    out.push(...u16(RECORD_TYPES[q.type]), ...u16(CLASS_IN));
  }
  for (const r of records) {
    writeName(r.name, out);
    const rdata = rdataOf(r);
    out.push(...u16(RECORD_TYPES[r.type]), ...u16(CLASS_IN), ...u32(r.ttl), ...u16(rdata.length), ...rdata);
  }
  return Buffer.from(out);
}

/** The query that asks the network for every instance of these service types. */
export function queryOf(services: string[]): Buffer {
  return writeMessage({
    questions: services.map((s) => ({ name: `${serviceType(s)}.${DOMAIN}`, type: 'PTR' as const })),
  });
}

class Reader {
  constructor(private readonly buf: Buffer) {}

  need(offset: number, length: number, what: string): void {
    if (offset + length > this.buf.length) {
      throw new MdnsError('message_invalid', `${what} runs past the end of the message (${this.buf.length} bytes)`);
    }
  }

  u16(offset: number): number {
    this.need(offset, 2, 'a 16-bit field');
    return this.buf.readUInt16BE(offset);
  }

  u32(offset: number): number {
    this.need(offset, 4, 'a 32-bit field');
    return this.buf.readUInt32BE(offset);
  }

  /** A name at `offset`, following compression pointers; returns it with the offset after it. */
  name(offset: number): [string, number] {
    const labels: string[] = [];
    let at = offset;
    let end = -1;
    let jumps = 0;
    for (;;) {
      this.need(at, 1, 'a name');
      const len = this.buf[at]!;
      if (len === 0) {
        if (end < 0) end = at + 1;
        break;
      }
      if ((len & 0xc0) === 0xc0) {
        const target = this.u16(at) & 0x3fff;
        if (end < 0) end = at + 2;
        if (++jumps > 64 || target >= this.buf.length) {
          throw new MdnsError('message_invalid', `a name at byte ${offset} points in a loop or outside the message`);
        }
        at = target;
        continue;
      }
      if ((len & 0xc0) !== 0) throw new MdnsError('message_invalid', `label type 0x${len.toString(16)} at byte ${at} is not read`);
      this.need(at + 1, len, 'a label');
      labels.push(this.buf.toString('utf8', at + 1, at + 1 + len));
      at += 1 + len;
    }
    return [labels.join('.'), end];
  }

  slice(offset: number, length: number): Buffer {
    this.need(offset, length, 'record data');
    return this.buf.subarray(offset, offset + length);
  }
}

function txtOf(data: Buffer): Record<string, string | true> {
  const txt: Record<string, string | true> = {};
  let at = 0;
  while (at < data.length) {
    const len = data[at]!;
    const entry = data.toString('utf8', at + 1, Math.min(data.length, at + 1 + len));
    at += 1 + len;
    if (!entry) continue;
    const eq = entry.indexOf('=');
    const key = (eq < 0 ? entry : entry.slice(0, eq)).toLowerCase();
    // RFC 6763 §6.4: the first occurrence of a key wins.
    if (key && !(key in txt)) txt[key] = eq < 0 ? true : entry.slice(eq + 1);
  }
  return txt;
}

function ipv6Of(data: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(data.readUInt16BE(i).toString(16));
  // The longest run of two or more zero groups becomes `::` (RFC 5952).
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j === i ? i + 1 : j;
  }
  if (best < 0) return groups.join(':');
  return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLen).join(':')}`;
}

/**
 * A DNS message read from its bytes: its questions, and its answer,
 * authority and additional records of the types DNS-SD reads (A, AAAA, PTR,
 * SRV, TXT), names decompressed. Refused as `message_invalid` when it is
 * cut short or a name loops.
 */
export function readMessage(buf: Buffer): DnsMessage {
  const r = new Reader(buf);
  const flags = r.u16(2);
  const qd = r.u16(4);
  const rr = r.u16(6) + r.u16(8) + r.u16(10);
  let at = 12;
  const questions: DnsQuestion[] = [];
  for (let i = 0; i < qd; i++) {
    const [name, next] = r.name(at);
    const type = TYPE_BY_NUMBER.get(r.u16(next));
    if (type) questions.push({ name, type });
    at = next + 4;
  }
  const records: DnsRecord[] = [];
  for (let i = 0; i < rr; i++) {
    const [name, next] = r.name(at);
    const type = TYPE_BY_NUMBER.get(r.u16(next));
    const ttl = r.u32(next + 4);
    const length = r.u16(next + 8);
    const start = next + 10;
    const data = r.slice(start, length);
    at = start + length;
    switch (type) {
      case 'PTR':
        records.push({ name, type, ttl, data: r.name(start)[0] });
        break;
      case 'SRV':
        records.push({
          name,
          type,
          ttl,
          data: { priority: r.u16(start), weight: r.u16(start + 2), port: r.u16(start + 4), target: r.name(start + 6)[0] },
        });
        break;
      case 'TXT':
        records.push({ name, type, ttl, data: txtOf(data) });
        break;
      case 'A':
        if (length === 4) records.push({ name, type, ttl, data: [...data].join('.') });
        break;
      case 'AAAA':
        if (length === 16) records.push({ name, type, ttl, data: ipv6Of(data) });
        break;
      default:
        break;
    }
  }
  return { response: (flags & 0x8000) !== 0, questions, records };
}

const lower = (s: string) => s.toLowerCase();
const withoutDomain = (s: string) => s.replace(/\.$/, '').replace(/\.local$/i, '');

/**
 * The instances of service the records name, assembled: each PTR record of
 * a service type gives an instance, its SRV record its host and port, its
 * TXT record its pairs, the A and AAAA records of the host its addresses.
 * A record with a time to live of zero says the instance has left; it is
 * left out. Services not in `services`, when given, are left out too.
 */
export function instancesOf(records: DnsRecord[], services?: string[]): DiscoveredService[] {
  const wanted = services ? new Set(services.map((s) => lower(serviceType(s)))) : null;
  const srv = new Map<string, Srv>();
  const txt = new Map<string, Record<string, string | true>>();
  const addresses = new Map<string, string[]>();
  const gone = new Set<string>();
  for (const rec of records) {
    const key = lower(rec.name);
    if (rec.ttl === 0) {
      if (rec.type === 'PTR') gone.add(lower(rec.data));
      continue;
    }
    if (rec.type === 'SRV') srv.set(key, rec.data);
    else if (rec.type === 'TXT') txt.set(key, rec.data);
    else if (rec.type === 'A' || rec.type === 'AAAA') {
      const list = addresses.get(key) ?? [];
      if (!list.includes(rec.data)) list.push(rec.data);
      addresses.set(key, list);
    }
  }
  const found = new Map<string, DiscoveredService>();
  for (const rec of records) {
    if (rec.type !== 'PTR' || rec.ttl === 0) continue;
    const service = withoutDomain(rec.name);
    if (!/^_[^.]+\._(tcp|udp)$/i.test(service)) continue;
    if (wanted && !wanted.has(lower(service))) continue;
    const instance = rec.data;
    const key = lower(instance);
    if (gone.has(key) || found.has(key)) continue;
    const suffix = `.${rec.name.replace(/\.$/, '')}`;
    const name = instance.toLowerCase().endsWith(suffix.toLowerCase()) ? instance.slice(0, -suffix.length) : instance;
    const s = srv.get(key);
    found.set(key, {
      name,
      service,
      host: s ? withoutDomain(s.target) : null,
      port: s ? s.port : null,
      addresses: s ? addresses.get(lower(s.target)) ?? [] : [],
      txt: txt.get(key) ?? {},
    });
  }
  return [...found.values()];
}

/** An entry of a catalogue as discovery sees it: how a device of it announces itself. */
export interface DiscoveryCandidate {
  /** What the caller names the entry by: a product, a template, a connector. */
  key: string;
  /** Service types, `_<service>._tcp`. */
  mdns?: string[];
  /** Host name patterns, `*` for any run of characters, without `.local`. */
  hostname?: string[];
}

const glob = (pattern: string) =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

/**
 * For each service found, the keys of the catalogue entries it may be: an
 * entry whose service types hold its type, or whose host name patterns
 * match its host. The catalogue is data the caller passes — the evcc
 * templates read by `@nexgen-os/evcc`, a list of its own; nothing is known
 * here of brands or models. A service no entry matches comes back with no
 * key, so that the caller can still show it.
 */
export function matchDiscovered(
  found: DiscoveredService[],
  candidates: DiscoveryCandidate[],
): Array<{ service: DiscoveredService; keys: string[] }> {
  const compiled = candidates.map((c) => ({
    key: c.key,
    services: new Set((c.mdns ?? []).map((s) => lower(serviceType(s)))),
    hosts: (c.hostname ?? []).map(glob),
  }));
  return found.map((service) => ({
    service,
    keys: compiled
      .filter(
        (c) =>
          c.services.has(lower(service.service)) || (service.host !== null && c.hosts.some((h) => h.test(service.host!))),
      )
      .map((c) => c.key),
  }));
}

/** How `discover()` reaches the network; `udpTransport()` unless the caller brings its own. */
export interface MdnsTransport {
  send(message: Buffer): void;
  onMessage(listener: (message: Buffer) => void): void;
  close(): void;
}

export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;

/**
 * A one-shot multicast DNS querier (RFC 6762 §5.1): a UDP socket on a port
 * of its own, not 5353, so that it runs beside the machine's own responder;
 * responders answer it by unicast to that port.
 */
export function udpTransport(options: { interface?: string } = {}): MdnsTransport {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const listeners: Array<(message: Buffer) => void> = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, () => {
      if (options.interface) socket.setMulticastInterface(options.interface);
      socket.setMulticastTTL(255);
      resolve();
    });
  });
  socket.on('message', (msg) => listeners.forEach((l) => l(msg)));
  return {
    send(message) {
      void ready.then(() => socket.send(message, MDNS_PORT, MDNS_ADDRESS));
    },
    onMessage(listener) {
      listeners.push(listener);
    },
    close() {
      void ready.finally(() => socket.close());
    },
  };
}

/**
 * The instances of these service types that answer on the place's network
 * within `timeoutMs` (3 s by default). The query is sent once at the start
 * and once more at a third of the time, as a lost multicast packet is
 * common; every answer received is read, an unreadable one is skipped and
 * counted.
 */
export async function discover(options: {
  services: string[];
  timeoutMs?: number;
  transport?: MdnsTransport;
}): Promise<{ services: DiscoveredService[]; unreadable: number }> {
  const services = options.services.map(serviceType);
  const timeoutMs = options.timeoutMs ?? 3000;
  const transport = options.transport ?? udpTransport();
  const records: DnsRecord[] = [];
  let unreadable = 0;
  transport.onMessage((msg) => {
    try {
      const message = readMessage(msg);
      if (message.response) records.push(...message.records);
    } catch {
      unreadable++;
    }
  });
  const query = queryOf(services);
  try {
    transport.send(query);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs / 3));
    transport.send(query);
    await new Promise((resolve) => setTimeout(resolve, timeoutMs - timeoutMs / 3));
  } finally {
    transport.close();
  }
  return { services: instancesOf(records, services), unreadable };
}
