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
 * reading per object every `keepEverySeconds`, and hands what it kept in
 * batches (`flush()`), as series by `meterSeriesOfDsmr()`, to be written.
 * Finding the object and writing its series are its caller's
 * (`MeasuredObjects` of `@nexgen-os/connector`): the core gives them with
 * `measuredObjects(db)`, which reads under the connection's rights and
 * writes through `store()`, the one write path, so that this package runs
 * without the core (decision 0064). `listen()` ties a stream to any MQTT client
 * that subscribes and emits `message` events (MQTT.js, or another): the
 * broker is a protocol, never a library this package ships
 * ([0014](../../../docs/decisions/0014-integrations-dashboards-warehouses-streams.md)).
 *
 * A message that cannot be placed is refused by name, never guessed:
 * `identifier_missing`, `identifier_unknown`, `identifier_ambiguous`,
 * `object_not_measured`, `time_zone_required`. A stream is never stopped by
 * one bad message.
 */
import { meterSeriesOfDsmr, type MeasuredObjects, type MeasuredTarget, type SourceRow } from '@nexgen-os/connector';
import { readP1m5, readTelegram, type DsmrOptions, type DsmrProblem, type DsmrReading } from '@nexgen-os/dsmr';

/** The source of what a P1 port says, as this package ships it: write it once with `registerSource()`. */
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
export type P1Target = MeasuredTarget;

/** What became of one message. */
export type P1Received =
  | { status: 'queued'; identifier: string; target: P1Target; at: string; problems: DsmrProblem[] }
  | { status: 'thinned'; identifier: string; target: P1Target; at: string }
  | { status: 'refused'; identifier: string | null; problems: DsmrProblem[] };

/** What one flush wrote, object by object. */
export interface P1Flushed {
  objectKind: 'meter' | 'device';
  objectId: string;
  /** The channel of the bus written: 0 the electricity meter, 1 to 4 a gas, water or heat meter of its bus. */
  channel: number;
  readings: number;
  /** Readings left out whole (undated, checksum), by their index in the batch. */
  skipped: { index: number; problems: DsmrProblem[] }[];
  series: { quantity_code: string; name: string | null; seriesId: string; inserted: number }[];
  /** The refusal of the caller when the batch could not be written; its readings are dropped. */
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
  /** The channel of the bus the batch reads: 0 the electricity meter, 1 to 4 a gas, water or heat meter. */
  channel: number;
  readings: DsmrReading[];
}

const problem = (code: string, detail: string): DsmrProblem => ({ code, detail });

/** A stream that writes the readings of dongles on the objects their identifiers name, found and written by `objects`. */
export function p1Stream(objects: MeasuredObjects, options: P1StreamOptions): P1Stream {
  const sourceCode = options.sourceCode ?? P1_PORT_SOURCE.code;
  const keepMs = (options.keepEverySeconds ?? 60) * 1000;
  const rememberMs = (options.rememberSeconds ?? 300) * 1000;
  const identifierOf = options.identifierOf ?? dongleIdentifier;
  const now = options.now ?? Date.now;
  const known = new Map<string, Known>();
  const lastKept = new Map<string, number>();
  let batches = new Map<string, Batch>();
  let pending = 0;

  function queue(target: P1Target, channel: number, reading: DsmrReading): void {
    const key = `${target.objectKind} ${target.objectId} ${channel}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { target, channel, readings: [] };
      batches.set(key, batch);
    }
    batch.readings.push(reading);
  }

  async function find(identifier: string): Promise<Known> {
    const remembered = known.get(identifier);
    if (remembered && remembered.until > now()) return remembered;
    const answer = await objects.byIdentifier(options.scheme, identifier, options.organisationId ? { organisationId: options.organisationId } : {});
    const found: Known = { until: now() + rememberMs, target: answer.target ?? null, problem: answer.problem ?? null };
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
      queue(target, 0, reading);
      // The meters of its bus land on the objects their own equipment
      // identifiers name, in the same scheme; one the installation did not
      // record is said, and the electricity meter is written all the same.
      const problems = [...reading.problems];
      for (const bus of reading.bus) {
        if (!bus.equipment_id) continue;
        const found = await find(bus.equipment_id);
        if (found.target) queue(found.target, bus.channel, reading);
        else problems.push(problem('bus_meter_unknown', `channel ${bus.channel}: ${found.problem!.detail}`));
      }
      pending += 1;
      return { status: 'queued', identifier, target, at: reading.at, problems };
    },

    async flush() {
      const taken = batches;
      batches = new Map();
      pending = 0;
      const out: P1Flushed[] = [];
      for (const { target, channel, readings } of taken.values()) {
        const { series, skipped } = meterSeriesOfDsmr(readings, { channel });
        const done: P1Flushed = { objectKind: target.objectKind, objectId: target.objectId, channel, readings: readings.length, skipped, series: [] };
        try {
          for (const s of series) {
            const stored = await objects.write(target, sourceCode, s);
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
