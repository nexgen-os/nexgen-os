/**
 * `@nexgen-os/mqtt`: the readings of P1 dongles, received from an MQTT
 * broker, as the series of the meters they read.
 *
 * A dongle on the P1 port of a smart meter publishes what the meter says,
 * every second or every few seconds, to a broker: the JSON message of the
 * open P1M5 firmware, or the DSMR telegram as the meter wrote it. A stream
 * of this package takes each message as it comes (`receive()`), finds the
 * object it belongs to by the dongle's identifier in the core's
 * `identifiers` (a scheme the installation names), reads it with
 * `@nexgen-os/dsmr` in the time zone of that object's participant, keeps one
 * reading per object every `keepEverySeconds`, and writes what it kept in
 * batches (`flush()`) through `meterSeriesOfDsmr()` and `storeSeries()`, the
 * one write path of the core. `listen()` ties a stream to any MQTT client
 * that subscribes and emits `message` events (MQTT.js, or another): the
 * broker is a protocol, never a library this package ships
 * ([0014](../../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md)).
 *
 * A message that cannot be placed is refused by name, never guessed:
 * `identifier_missing`, `identifier_unknown`, `identifier_ambiguous`,
 * `object_not_measured`, `time_zone_required`. A stream is never stopped by
 * one bad message.
 */
import {
  meterSeriesOfDsmr,
  registerSource,
  storeSeries,
  type Db,
  type SourceRow,
} from '@nexgen-os/core';
import { readP1m5, readTelegram, type DsmrOptions, type DsmrProblem, type DsmrReading } from '@nexgen-os/dsmr';

/** The source of what a P1 port says, as this package ships it. */
export const P1_PORT_SOURCE: SourceRow = {
  code: 'p1_port',
  name: 'The P1 port of a smart meter',
  description: 'What a smart meter says on its P1 port (DSMR, e-MUCS): energy registers, power and voltage, dated by the meter clock; read by a dongle on the port and received from an MQTT broker.',
  kind: 'device',
  auth: 'none',
  license: null,
  redistributable: false,
  published_by: '@nexgen-os/mqtt',
};

/** Writes the `sources` row of the P1 port, once. */
export async function registerP1PortSource(db: Db): Promise<void> {
  await registerSource(db, P1_PORT_SOURCE);
}

/**
 * Reads one message of a dongle: a P1M5 JSON message (text starting with
 * `{`, or a parsed object), or a DSMR telegram (text starting with `/`).
 */
export function readP1Message(payload: string | Uint8Array | Record<string, unknown>, options: DsmrOptions = {}): DsmrReading {
  if (typeof payload === 'object' && !(payload instanceof Uint8Array)) return readP1m5(payload, options);
  const text = typeof payload === 'string' ? payload : new TextDecoder('utf-8').decode(payload);
  return text.trimStart().startsWith('/') ? readTelegram(text, options) : readP1m5(text, options);
}

/**
 * The identifier a reading names its dongle by: the `dongle_id` of a P1M5
 * message, otherwise the meter's equipment identifier (`0-0:96.1.1`).
 */
export function dongleIdentifier(_topic: string, reading: DsmrReading): string | null {
  const id = reading.fields['dongle_id'];
  if (typeof id === 'string' && id.trim() !== '') return id.trim();
  return reading.equipment_id;
}

/** Whether a topic matches an MQTT topic filter, with its `+` and `#` wildcards. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    // `#` is last and matches its parent level too: `a/#` matches `a`.
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export interface P1StreamOptions {
  /** The identifier scheme the installation records its dongles under (`identifier_schemes`), on a meter or a device. */
  scheme: string;
  /** Only the identifiers of this organisation; any the connection may read otherwise. */
  organisationId?: string;
  /** The source the series are written under; `p1_port` by default. */
  sourceCode?: string;
  /** Keeps one reading per object every that many seconds of meter time; 60 by default, 0 keeps them all. */
  keepEverySeconds?: number;
  /** How long a dongle found, or not found, stays known before it is looked up again; 300 seconds by default. */
  rememberSeconds?: number;
  /** The identifier of a message's dongle; `dongleIdentifier()` by default. */
  identifierOf?: (topic: string, reading: DsmrReading) => string | null;
  /** The clock, for the memory of dongles; `Date.now` by default. */
  now?: () => number;
}

/** The object a dongle's readings land on. */
export interface P1Target {
  organisationId: string;
  objectKind: 'meter' | 'device';
  objectId: string;
  timeZone: string;
}

/** What became of one message. */
export type P1Received =
  | { status: 'queued'; identifier: string; target: P1Target; at: string; problems: DsmrProblem[] }
  | { status: 'thinned'; identifier: string; target: P1Target; at: string }
  | { status: 'refused'; identifier: string | null; problems: DsmrProblem[] };

/** What one flush wrote, object by object. */
export interface P1Flushed {
  objectKind: 'meter' | 'device';
  objectId: string;
  readings: number;
  /** Readings left out whole (undated, checksum), by their index in the batch. */
  skipped: { index: number; problems: DsmrProblem[] }[];
  series: { quantity_code: string; name: string | null; seriesId: string; inserted: number }[];
  /** The refusal of the core when the batch could not be written; its readings are dropped. */
  error?: string;
}

/** A stream of P1 messages: receive them as they come, write them in batches. */
export interface P1Stream {
  receive(topic: string, payload: string | Uint8Array | Record<string, unknown>): Promise<P1Received>;
  flush(): Promise<P1Flushed[]>;
  /** Readings waiting for the next flush. */
  readonly pending: number;
}

interface Known {
  until: number;
  target: P1Target | null;
  problem: DsmrProblem | null;
}

interface Batch {
  target: P1Target;
  readings: DsmrReading[];
}

const problem = (code: string, detail: string): DsmrProblem => ({ code, detail });

/** A stream that writes the readings of dongles on the objects their identifiers name. */
export function p1Stream(db: Db, options: P1StreamOptions): P1Stream {
  const sourceCode = options.sourceCode ?? P1_PORT_SOURCE.code;
  const keepMs = (options.keepEverySeconds ?? 60) * 1000;
  const rememberMs = (options.rememberSeconds ?? 300) * 1000;
  const identifierOf = options.identifierOf ?? dongleIdentifier;
  const now = options.now ?? Date.now;
  const known = new Map<string, Known>();
  const lastKept = new Map<string, number>();
  let batches = new Map<string, Batch>();
  let pending = 0;

  async function find(identifier: string): Promise<Known> {
    const remembered = known.get(identifier);
    if (remembered && remembered.until > now()) return remembered;
    const { rows } = await db.query<{ organisation_id: string; object_kind: string; object_id: string; time_zone: string | null }>(
      `select i.organisation_id::text, i.object_kind, i.object_id::text, p.time_zone
         from identifiers i
         left join participants p on p.id = participant_of(i.object_kind, i.object_id)
        where i.scheme = $1 and i.value = $2
          and (i.valid_from is null or i.valid_from <= now())
          and (i.valid_to is null or i.valid_to > now())
          and ($3::uuid is null or i.organisation_id = $3::uuid)`,
      [options.scheme, identifier, options.organisationId ?? null],
    );
    let found: Known = { until: now() + rememberMs, target: null, problem: null };
    const row = rows[0];
    if (!row) {
      found.problem = problem('identifier_unknown', `no meter or device is known by ${options.scheme} ${identifier}`);
    } else if (rows.length > 1) {
      found.problem = problem('identifier_ambiguous', `${options.scheme} ${identifier} names an object in ${rows.length} organisations; give organisationId`);
    } else if (row.object_kind !== 'meter' && row.object_kind !== 'device') {
      found.problem = problem('object_not_measured', `${options.scheme} ${identifier} names a ${row.object_kind}, not a meter or a device`);
    } else if (!row.time_zone) {
      found.problem = problem('time_zone_required', `the participant of ${row.object_kind} ${row.object_id} has no time zone: the meter's clock cannot be dated`);
    } else {
      found = { ...found, target: { organisationId: row.organisation_id, objectKind: row.object_kind, objectId: row.object_id, timeZone: row.time_zone } };
    }
    known.set(identifier, found);
    return found;
  }

  return {
    get pending() {
      return pending;
    },

    async receive(topic, payload) {
      // The identifier does not depend on the clock: read once to find the
      // dongle, then again in its participant's zone.
      const first = readP1Message(payload);
      const identifier = identifierOf(topic, first);
      if (!identifier) {
        const unreadable = first.problems.filter((p) => p.code === 'telegram_unreadable');
        return {
          status: 'refused', identifier: null,
          problems: unreadable.length > 0 ? unreadable : [problem('identifier_missing', `the message on ${topic} names no dongle`)],
        };
      }
      const { target, problem: refusal } = await find(identifier);
      if (!target) return { status: 'refused', identifier, problems: [refusal!] };
      const reading = readP1Message(payload, { timeZone: target.timeZone });
      if (reading.at === null) return { status: 'refused', identifier, problems: reading.problems };
      const key = `${target.objectKind} ${target.objectId}`;
      const at = Date.parse(reading.at);
      const last = lastKept.get(key);
      if (last !== undefined && keepMs > 0 && at >= last && at - last < keepMs) {
        return { status: 'thinned', identifier, target, at: reading.at };
      }
      if (last === undefined || at > last) lastKept.set(key, at);
      let batch = batches.get(key);
      if (!batch) {
        batch = { target, readings: [] };
        batches.set(key, batch);
      }
      batch.readings.push(reading);
      pending += 1;
      return { status: 'queued', identifier, target, at: reading.at, problems: reading.problems };
    },

    async flush() {
      const taken = batches;
      batches = new Map();
      pending = 0;
      const out: P1Flushed[] = [];
      for (const { target, readings } of taken.values()) {
        const { series, skipped } = meterSeriesOfDsmr(readings);
        const done: P1Flushed = { objectKind: target.objectKind, objectId: target.objectId, readings: readings.length, skipped, series: [] };
        try {
          for (const s of series) {
            const stored = await storeSeries(db, {
              organisationId: target.organisationId, objectKind: target.objectKind, objectId: target.objectId, sourceCode, kind: 'measured',
            }, s);
            done.series.push({ quantity_code: s.quantity_code, name: s.name ?? null, seriesId: stored.seriesId, inserted: stored.inserted });
          }
        } catch (error) {
          done.error = error instanceof Error ? error.message : String(error);
        }
        out.push(done);
      }
      return out;
    },
  };
}

/** What `listen()` needs of an MQTT client: MQTT.js fits as it is. */
export interface MqttClient {
  subscribe(topic: string | string[], ...rest: unknown[]): unknown;
  on(event: 'message', listener: (topic: string, payload: Uint8Array) => void): unknown;
  removeListener(event: 'message', listener: (topic: string, payload: Uint8Array) => void): unknown;
}

export interface ListenOptions {
  /** The topic filters to subscribe to (`p1/+/data/readings`); a message on another topic of the client is ignored. */
  topics: string[];
  /** Writes the readings kept every that many seconds; 60 by default. */
  flushEverySeconds?: number;
  onReceived?: (received: P1Received, topic: string) => void;
  onFlushed?: (flushed: P1Flushed[]) => void;
  /** A failure of the database or of a callback; the stream goes on. */
  onError?: (error: unknown) => void;
}

/**
 * Subscribes a client to the topics and feeds the stream with their
 * messages, one at a time, in the order they came; flushes on a timer.
 * `stop()` stops listening and writes what is left.
 */
export function listen(client: MqttClient, stream: P1Stream, options: ListenOptions): { stop(): Promise<P1Flushed[]> } {
  // One connection, one thing at a time: every message and every flush
  // waits for the one before it.
  let chain: Promise<unknown> = Promise.resolve();
  const onError = options.onError ?? (() => {});
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work);
    chain = next.catch(onError);
    return next;
  };
  const flush = () => enqueue(async () => {
    const flushed = await stream.flush();
    if (flushed.length > 0) options.onFlushed?.(flushed);
    return flushed;
  });
  const listener = (topic: string, payload: Uint8Array) => {
    if (!options.topics.some((f) => topicMatches(f, topic))) return;
    void enqueue(async () => {
      const received = await stream.receive(topic, payload);
      options.onReceived?.(received, topic);
    }).catch(() => {});
  };
  client.on('message', listener);
  client.subscribe(options.topics);
  const timer = setInterval(() => void flush().catch(() => {}), (options.flushEverySeconds ?? 60) * 1000);
  timer.unref?.();
  return {
    async stop() {
      clearInterval(timer);
      client.removeListener('message', listener);
      return flush();
    },
  };
}
