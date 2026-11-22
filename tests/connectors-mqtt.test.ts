// @nexgen-os/mqtt, offline: the messages of a P1M5 dongle and a DSMR
// telegram with made-up identifiers and values, a client that only emits
// what the test gives it. Then the whole path on a database: the dongle
// found by its identifier on a meter, its readings dated in the
// participant's zone, thinned, and written as the meter's series.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { measuredObjects, registerSource } from '@nexgen-os/core';
import { dongleIdentifier, listen, P1_PORT_SOURCE, p1Stream, readP1Message, topicMatches, type MqttClient } from '@nexgen-os/mqtt';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

const telegram = readFileSync(new URL('../packages/formats/dsmr/tests/fixtures/emucs-three-phase.txt', import.meta.url), 'latin1');

/** A P1M5 message, its meter on summer time. */
const message = (dongle: string, stamp: string, t1: number, offtake: number) => JSON.stringify({
  '0-0:1.0.0': stamp,
  '0-0:96.1.1': '3153414731323334353637383930',
  '1-0:1.8.1': { value: t1, unit: 'kWh' },
  '1-0:1.8.2': { value: 2345.0, unit: 'kWh' },
  '1-0:2.8.1': { value: 456.789, unit: 'kWh' },
  '1-0:2.8.2': { value: 123.456, unit: 'kWh' },
  '1-0:1.7.0': { value: offtake, unit: 'kW' },
  '1-0:2.7.0': { value: 0, unit: 'kW' },
  '1-0:32.7.0': { value: 236.1, unit: 'V' },
  dongle_id: dongle,
});

describe('a message of a dongle', () => {
  it('is read as a P1M5 message or as a telegram, from text or bytes', () => {
    const json = readP1Message(new TextEncoder().encode(message('P1000001', '261015140000S', 1234, 0.4)), { timeZone: 'Europe/Brussels' });
    expect(json.at).toBe('2026-10-15T12:00:00.000Z');
    expect(dongleIdentifier('p1/x/data/readings', json)).toBe('P1000001');
    const dsmr = readP1Message(telegram, { timeZone: 'Europe/Brussels' });
    expect(dsmr.crc).toBe('valid');
    expect(dongleIdentifier('p1/x', dsmr)).toBe(dsmr.equipment_id);
    expect(readP1Message('not a message').problems.map((p) => p.code)).toEqual(['telegram_unreadable']);
  });

  it('matches the topic filters of MQTT', () => {
    expect(topicMatches('p1/+/data/readings', 'p1/P1000001/data/readings')).toBe(true);
    expect(topicMatches('p1/+/data/readings', 'p1/P1000001/data/status')).toBe(false);
    expect(topicMatches('p1/#', 'p1')).toBe(true);
    expect(topicMatches('p1/#', 'p1/a/b')).toBe(true);
    expect(topicMatches('p1/+', 'p1/a/b')).toBe(false);
    expect(topicMatches('p1/a', 'p1')).toBe(false);
  });
});

describe('a stream of dongles on a database', () => {
  let db: PGlite;
  let org: string;
  let meter: string;
  let clock = 0;

  beforeAll(async () => {
    db = await freshDatabase();
    org = await organisation(db, 'A cooperative');
    const project = await insert(db, 'projects', { organisation_id: org, name: 'Village community', kind: 'energy_community', country: 'BE', status: 'creation' });
    const place = JSON.stringify({ address_line1: 'Rue 1', city: 'Lasne', country: 'BE' });
    const join = async (name: string, zone: string | null) => (await one<{ id: string }>(
      db, `select join_project($1, $2, $3, 'prosumer', null, '2026-01-01', p_time_zone => $4) id`, [project, name, place, zone])).id;
    const home = await join('House 1', 'Europe/Brussels');
    const unplaced = await join('House 2', null);
    meter = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000001', 'gs1_gsrn') id`, [home])).id;
    const other = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000002', 'gs1_gsrn') id`, [unplaced])).id;
    // The installation names the scheme its dongles are known by.
    await db.query(`insert into identifier_schemes (code, name, pattern) values ('p1_dongle', 'A P1 dongle', '^P1[0-9]{6}$')`);
    await db.query(`select add_identifier('meter', $1, 'p1_dongle', 'P1000001')`, [meter]);
    await db.query(`select add_identifier('meter', $1, 'p1_dongle', 'P1000002')`, [other]);
    await db.query(`select add_identifier('project', $1, 'p1_dongle', 'P1000003')`, [project]);
    await registerSource(db, P1_PORT_SOURCE);
  });

  afterAll(async () => {
    await db.close();
  });

  it('writes the readings of a dongle on its meter, one a minute, and the quarter hours give the energy taken', async () => {
    const stream = p1Stream(measuredObjects(db), { scheme: 'p1_dongle', now: () => clock });
    const received = [];
    for (const [stamp, t1] of [['261015140000S', 1234.0], ['261015140010S', 1234.001], ['261015141500S', 1234.1], ['261015143000S', 1234.2]] as const) {
      received.push(await stream.receive('p1/P1000001/data/readings', message('P1000001', stamp, t1, 0.4)));
    }
    expect(received.map((r) => r.status)).toEqual(['queued', 'thinned', 'queued', 'queued']);
    expect(stream.pending).toBe(3);
    const flushed = await stream.flush();
    expect(stream.pending).toBe(0);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toMatchObject({ objectKind: 'meter', objectId: meter, readings: 3, skipped: [] });
    expect(flushed[0]!.error).toBeUndefined();
    const tariff1 = flushed[0]!.series.find((s) => s.quantity_code === 'offtake_energy' && s.name === 'tariff 1')!;
    expect(tariff1.inserted).toBe(3);
    const quarters = await db.query<{ value: number }>(
      `select round(value::numeric, 3)::float8 as value from resample($1, '2026-10-15 12:00Z', '2026-10-15 12:30Z', '15 minutes')`, [tariff1.seriesId]);
    expect(quarters.rows.map((r) => r.value)).toEqual([0.1, 0.1]);
    const series = await one<{ source_code: string; kind: string }>(db, 'select source_code, kind from series where id = $1', [tariff1.seriesId]);
    expect(series).toEqual({ source_code: 'p1_port', kind: 'measured' });
    // Nothing left: a second flush writes nothing.
    expect(await stream.flush()).toEqual([]);
  });

  it('refuses by name a message it cannot place, and goes on', async () => {
    const stream = p1Stream(measuredObjects(db), { scheme: 'p1_dongle', now: () => clock });
    const codes = async (payload: string) => {
      const r = await stream.receive('p1/x/data/readings', payload);
      return r.status === 'refused' ? r.problems.map((p) => p.code) : r.status;
    };
    expect(await codes(message('P1999999', '261015140000S', 1, 0))).toEqual(['identifier_unknown']);
    expect(await codes(message('P1000002', '261015140000S', 1, 0))).toEqual(['time_zone_required']);
    expect(await codes(message('P1000003', '261015140000S', 1, 0))).toEqual(['object_not_measured']);
    expect(await codes(JSON.stringify({ '1-0:1.8.1': { value: 1, unit: 'kWh' } }))).toEqual(['identifier_missing']);
    expect(await codes('{ not json')).toEqual(['telegram_unreadable']);
    expect(await codes(JSON.stringify({ '1-0:1.8.1': { value: 1, unit: 'kWh' }, dongle_id: 'P1000001' }))).toEqual(['time_missing']);
    expect(await codes(message('P1000001', '261015150000S', 1234.5, 0))).toBe('queued');
    expect(stream.pending).toBe(1);
  });

  it('remembers a dongle for a while, then looks it up again', async () => {
    const stream = p1Stream(measuredObjects(db), { scheme: 'p1_dongle', rememberSeconds: 60, now: () => clock });
    const status = async () => (await stream.receive('p1/x', message('P1000009', '261016140000S', 1, 0))).status;
    expect(await status()).toBe('refused');
    await db.query(`select add_identifier('meter', $1, 'p1_dongle', 'P1000009')`, [meter]);
    expect(await status()).toBe('refused');
    clock += 61_000;
    expect(await status()).toBe('queued');
  });

  it('writes the gas meter of its bus on the meter its own identifier names, and says a meter of the bus nobody recorded', async () => {
    const home = (await one<{ id: string }>(db, `select participant_of('meter', $1) id`, [meter])).id;
    const gas = (await one<{ id: string }>(db, `select declare_meter($1, '541448000000000011', 'gs1_gsrn', 'gas', 'offtake') id`, [home])).id;
    await db.query(`insert into identifier_schemes (code, name, pattern) values ('p1_meter', 'A meter on a P1 port', '^[0-9A-Z]+$')`);
    await db.query(`select add_identifier('meter', $1, 'p1_meter', 'P1000001')`, [meter]);
    // The telegram names its electricity meter by the topic, and the gas meter of its bus by its own identifier.
    const stream = p1Stream(measuredObjects(db), {
      scheme: 'p1_meter', identifierOf: (topic) => topic.split('/')[1] ?? null, keepEverySeconds: 0, rememberSeconds: 0, now: () => clock,
    });
    const unknown = await stream.receive('p1/P1000001/telegram', telegram);
    expect(unknown).toMatchObject({ status: 'queued', problems: [{ code: 'bus_meter_unknown' }] });
    await db.query(`select add_identifier('meter', $1, 'p1_meter', '7FLO2123456789')`, [gas]);
    expect(await stream.receive('p1/P1000001/telegram', telegram)).toMatchObject({ status: 'queued', problems: [] });
    const flushed = await stream.flush();
    const electricity = flushed.filter((f) => f.objectId === meter);
    expect(electricity).toEqual([expect.objectContaining({ channel: 0, readings: 2 })]);
    const ofGas = flushed.find((f) => f.objectId === gas)!;
    expect(ofGas).toMatchObject({ objectKind: 'meter', channel: 1, readings: 1, skipped: [] });
    expect(ofGas.error).toBeUndefined();
    expect(ofGas.series).toEqual([expect.objectContaining({ quantity_code: 'volume', inserted: 1 })]);
    const volume = await one<{ value: number; at: string }>(
      db, `select v.value::float8 value, v.at::text from series_values v where v.series_id = $1`, [ofGas.series[0]!.seriesId]);
    expect(volume.value).toBeCloseTo(872.234, 3);
  });

  it('listens to a client on its topics, one message at a time, and writes what is left when stopped', async () => {
    const client = new (class extends EventEmitter {
      subscribed: string[] = [];
      subscribe(topics: string | string[]) {
        this.subscribed.push(...[topics].flat());
      }
    })();
    const stream = p1Stream(measuredObjects(db), { scheme: 'p1_dongle', keepEverySeconds: 0, now: () => clock });
    const statuses: string[] = [];
    const listening = listen(client as unknown as MqttClient, stream, {
      topics: ['p1/+/data/readings'],
      onReceived: (r) => statuses.push(r.status),
    });
    expect(client.subscribed).toEqual(['p1/+/data/readings']);
    const bytes = (stamp: string, t1: number) => new TextEncoder().encode(message('P1000001', stamp, t1, 0.2));
    client.emit('message', 'p1/P1000001/data/readings', bytes('261017140000S', 1300));
    client.emit('message', 'p1/P1000001/data/status', bytes('261017140001S', 1300));
    client.emit('message', 'p1/P1000001/data/readings', bytes('261017140005S', 1300.001));
    const flushed = await listening.stop();
    expect(statuses).toEqual(['queued', 'queued']);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.readings).toBe(2);
    expect(client.listenerCount('message')).toBe(0);
  });
});
