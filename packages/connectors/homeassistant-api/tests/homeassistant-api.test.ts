// @nexgen-os/homeassistant-api, offline: a fake installation answers the
// WebSocket commands as Home Assistant documents them, and the snapshot it
// gives is read by @nexgen-os/homeassistant into the shapes the building
// module imports.
import { describe, expect, it } from 'vitest';
import { readHomeAssistant } from '@nexgen-os/homeassistant';
import { connectHomeAssistant, homeAssistantSnapshot, websocketUrl, type HaSocket } from '../src/index.js';

const T0 = Date.parse('2026-06-21T10:00:00Z') / 1000;

const REGISTRIES: Record<string, unknown> = {
  'config/floor_registry/list': [{ floor_id: 'ground', name: 'Ground floor', level: 0, icon: null, aliases: [], created_at: 0, modified_at: 0 }],
  'config/area_registry/list': [{ area_id: 'garage', name: 'Garage', floor_id: 'ground', icon: 'mdi:garage', aliases: [], picture: null, labels: [] }],
  'config/device_registry/list': [
    {
      id: 'dev-inverter', name: 'SUN2000-4KTL', name_by_user: 'Inverter', manufacturer: 'Huawei', model: 'SUN2000-4KTL-L1',
      sw_version: 'V200', hw_version: null, serial_number: 'HV22', area_id: 'garage', via_device_id: null,
      identifiers: [['huawei_solar', 'HV22']], connections: [['mac', 'aa:bb:cc:dd:ee:01']], config_entries: ['x'], labels: [],
    },
    { id: 'dev-plug', name: 'Plug', name_by_user: null, manufacturer: 'Shelly', model: 'Plug S', sw_version: null, hw_version: null, serial_number: null, area_id: null, via_device_id: null, identifiers: [], connections: [] },
  ],
  'config/entity_registry/list': [
    { entity_id: 'sensor.inverter_active_power', unique_id: 'HV22-p', platform: 'huawei_solar', name: null, original_name: 'Active power', device_id: 'dev-inverter', area_id: null, icon: null, entity_category: null, disabled_by: null, has_entity_name: true },
    { entity_id: 'sensor.inverter_energy', unique_id: 'HV22-e', platform: 'huawei_solar', name: null, original_name: 'Total yield', device_id: 'dev-inverter', area_id: null, icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'switch.plug', unique_id: 'plug-1', platform: 'shelly', name: null, original_name: null, device_id: 'dev-plug', area_id: null, icon: null, entity_category: null, disabled_by: null },
    { entity_id: 'sensor.plug_rssi', unique_id: 'plug-rssi', platform: 'shelly', name: null, original_name: 'RSSI', device_id: 'dev-plug', area_id: null, icon: null, entity_category: 'diagnostic', disabled_by: 'integration' },
  ],
  get_states: [
    { entity_id: 'sensor.inverter_active_power', state: '2345', attributes: { device_class: 'power', state_class: 'measurement', unit_of_measurement: 'W' }, last_changed: '2026-06-21T12:30:00.123456+00:00', last_updated: '2026-06-21T12:30:00.123456+00:00' },
    { entity_id: 'sensor.inverter_energy', state: '1520.5', attributes: { device_class: 'energy', state_class: 'total_increasing', unit_of_measurement: 'kWh' }, last_changed: '2026-06-21T12:30:00+00:00', last_updated: '2026-06-21T12:30:00+00:00' },
    { entity_id: 'switch.plug', state: 'on', attributes: {}, last_changed: '2026-06-21T08:00:00+00:00', last_updated: '2026-06-21T08:00:00+00:00' },
    { entity_id: 'sensor.yaml_only', state: '3', attributes: {}, last_changed: '2026-06-21T08:00:00+00:00', last_updated: '2026-06-21T08:00:00+00:00' },
  ],
  'history/history_during_period': {
    'sensor.inverter_active_power': [{ s: '2345', lu: T0 }, { s: '3120.5', lu: T0 + 3600 }, { s: 'unavailable', lu: T0 + 7200 }],
    'sensor.inverter_energy': [{ s: '1500', lu: T0 }],
    'switch.plug': [{ s: 'off', lc: T0 }, { s: 'on', lu: T0 + 1800 }],
  },
};

interface Sent { id?: number; type: string; [key: string]: unknown }

/** A fake installation behind a socket: asks for auth, checks the token, answers each command from `answers`. */
function fakeHomeAssistant(answers: Record<string, unknown>, token = 'llat', refuse: Record<string, { code: string; message: string }> = {}) {
  const sent: Sent[] = [];
  const urls: string[] = [];
  let closed = false;
  const open = (url: string): HaSocket => {
    urls.push(url);
    const socket: HaSocket = {
      onmessage: null, onerror: null, onclose: null,
      send(data) {
        const m = JSON.parse(data) as Sent;
        sent.push(m);
        const reply = (o: unknown) => queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify(o) }));
        if (m.type === 'auth') {
          reply(m.access_token === token ? { type: 'auth_ok', ha_version: '2026.10.1' } : { type: 'auth_invalid', message: 'Invalid access token or password' });
        } else if (refuse[m.type]) {
          reply({ id: m.id, type: 'result', success: false, error: refuse[m.type] });
        } else if (m.type in answers) {
          reply({ id: m.id, type: 'result', success: true, result: answers[m.type] });
        }
      },
      close() {
        if (closed) return;
        closed = true;
        queueMicrotask(() => socket.onclose?.({}));
      },
    };
    queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ type: 'auth_required', ha_version: '2026.10.1' }) }));
    return socket;
  };
  return { open, sent, urls, isClosed: () => closed };
}

describe('websocketUrl', () => {
  it('turns the address of an installation into its WebSocket', () => {
    expect(websocketUrl('http://homeassistant.local:8123')).toBe('ws://homeassistant.local:8123/api/websocket');
    expect(websocketUrl('https://home.example.org/')).toBe('wss://home.example.org/api/websocket');
    expect(websocketUrl('https://home.example.org/api/websocket')).toBe('wss://home.example.org/api/websocket');
    expect(() => websocketUrl('ftp://home')).toThrow(/invalid_url/);
  });
});

describe('connectHomeAssistant', () => {
  it('authenticates with the token and gives the version', async () => {
    const ha = fakeHomeAssistant(REGISTRIES);
    const session = await connectHomeAssistant({ url: 'http://ha.local:8123', token: 'llat', socket: ha.open });
    expect(session.version).toBe('2026.10.1');
    expect(ha.sent[0]).toEqual({ type: 'auth', access_token: 'llat' });
    expect(ha.urls).toEqual(['ws://ha.local:8123/api/websocket']);
    session.close();
    expect(ha.isClosed()).toBe(true);
  });

  it('refuses a token the installation refuses, and a missing one', async () => {
    const ha = fakeHomeAssistant(REGISTRIES);
    await expect(connectHomeAssistant({ url: 'http://ha.local:8123', token: 'wrong', socket: ha.open })).rejects.toMatchObject({ code: 'source_unauthorised' });
    await expect(connectHomeAssistant({ url: 'http://ha.local:8123', token: '', socket: ha.open })).rejects.toMatchObject({ code: 'secret_not_found' });
  });

  it('names a command the installation refuses', async () => {
    const ha = fakeHomeAssistant(REGISTRIES, 'llat', { get_states: { code: 'unauthorized', message: 'Unauthorized' } });
    const session = await connectHomeAssistant({ url: 'http://ha.local:8123', token: 'llat', socket: ha.open });
    await expect(session.call('get_states')).rejects.toMatchObject({ code: 'source_refused', message: expect.stringContaining('unauthorized') });
    session.close();
  });

  it('gives up on an answer that does not come', async () => {
    const ha = fakeHomeAssistant({});
    const session = await connectHomeAssistant({ url: 'http://ha.local:8123', token: 'llat', socket: ha.open, timeoutMs: 20 });
    await expect(session.call('get_states')).rejects.toMatchObject({ code: 'source_timeout' });
    session.close();
  });
});

describe('homeAssistantSnapshot', () => {
  const options = (ha: ReturnType<typeof fakeHomeAssistant>) => ({ url: 'http://ha.local:8123', token: 'llat', socket: ha.open });

  it('reads the registries and the recorder over a period, as the file format has them', async () => {
    const ha = fakeHomeAssistant(REGISTRIES);
    const snapshot = await homeAssistantSnapshot(options(ha), { from: '2026-06-21T10:00:00Z', to: '2026-06-21T13:00:00Z' });

    expect(snapshot.floors).toEqual([{ floor_id: 'ground', name: 'Ground floor', level: 0, icon: null, aliases: [] }]);
    expect(snapshot.areas).toEqual([{ area_id: 'garage', name: 'Garage', floor_id: 'ground', icon: 'mdi:garage', aliases: [] }]);
    expect(snapshot.devices.map((d) => d.id)).toEqual(['dev-inverter', 'dev-plug']);
    expect(snapshot.devices[0]).toEqual({
      id: 'dev-inverter', name: 'SUN2000-4KTL', name_by_user: 'Inverter', manufacturer: 'Huawei', model: 'SUN2000-4KTL-L1',
      sw_version: 'V200', hw_version: null, serial_number: 'HV22', area_id: 'garage', via_device_id: null,
      identifiers: [['huawei_solar', 'HV22']], connections: [['mac', 'aa:bb:cc:dd:ee:01']],
    });
    // A disabled entity is left out by default; one without a registry entry has no identity.
    expect(snapshot.entities.map((e) => e.entity_id)).toEqual(['sensor.inverter_active_power', 'sensor.inverter_energy', 'switch.plug']);
    expect(snapshot.entities[1]).toMatchObject({ original_device_class: 'energy', state_class: 'total_increasing', unit_of_measurement: 'kWh' });

    const history = ha.sent.find((m) => m.type === 'history/history_during_period')!;
    expect(history).toMatchObject({
      start_time: '2026-06-21T10:00:00.000Z', end_time: '2026-06-21T13:00:00.000Z',
      entity_ids: ['sensor.inverter_active_power', 'sensor.inverter_energy', 'switch.plug'], minimal_response: true, no_attributes: true,
    });
    expect(snapshot.states).toEqual([
      { entity_id: 'sensor.inverter_active_power', state: '2345', last_updated: '2026-06-21T10:00:00.000Z' },
      { entity_id: 'sensor.inverter_active_power', state: '3120.5', last_updated: '2026-06-21T11:00:00.000Z' },
      { entity_id: 'sensor.inverter_active_power', state: 'unavailable', last_updated: '2026-06-21T12:00:00.000Z' },
      { entity_id: 'sensor.inverter_energy', state: '1500', last_updated: '2026-06-21T10:00:00.000Z' },
      { entity_id: 'switch.plug', state: 'off', last_updated: '2026-06-21T10:00:00.000Z' },
      { entity_id: 'switch.plug', state: 'on', last_updated: '2026-06-21T10:30:00.000Z' },
    ]);
    expect(ha.isClosed()).toBe(true);

    // What @nexgen-os/homeassistant makes of it, for importHomeAssistant().
    const home = readHomeAssistant(snapshot);
    const power = home.points.find((p) => p.key === 'sensor.inverter_active_power')!;
    expect(power).toMatchObject({ device: 'dev-inverter', deviceClass: 'power', unit: 'W', role: 'measured', valueKind: 'instant' });
    expect(power.readings.map((r) => r.value)).toEqual([2345, 3120.5, null]);
    expect(home.points.find((p) => p.key === 'sensor.inverter_energy')!.valueKind).toBe('cumulative');
    expect(home.points.find((p) => p.key === 'switch.plug')!).toMatchObject({ role: 'command', binary: true });
    expect(home.devices.find((d) => d.key === 'dev-inverter')!).toMatchObject({ name: 'Inverter', space: 'garage' });
  });

  it('reads the current states without a period, for the entities asked only', async () => {
    const ha = fakeHomeAssistant(REGISTRIES);
    const snapshot = await homeAssistantSnapshot(options(ha), { entities: ['sensor.inverter_energy'] });
    expect(ha.sent.some((m) => m.type === 'history/history_during_period')).toBe(false);
    expect(snapshot.entities.map((e) => e.entity_id)).toEqual(['sensor.inverter_energy']);
    expect(snapshot.devices.map((d) => d.id)).toEqual(['dev-inverter']);
    expect(snapshot.states).toEqual([{ entity_id: 'sensor.inverter_energy', state: '1520.5', last_updated: '2026-06-21T12:30:00.000Z' }]);
  });

  it('refuses an entity the installation has not registered', async () => {
    const ha = fakeHomeAssistant(REGISTRIES);
    await expect(homeAssistantSnapshot(options(ha), { entities: ['sensor.yaml_only'] })).rejects.toMatchObject({ code: 'entity_not_found' });
    expect(ha.isClosed()).toBe(true);
  });

  it('reads an installation older than floors as having none', async () => {
    const ha = fakeHomeAssistant(REGISTRIES, 'llat', { 'config/floor_registry/list': { code: 'unknown_command', message: 'Unknown command.' } });
    const snapshot = await homeAssistantSnapshot(options(ha));
    expect(snapshot.floors).toEqual([]);
    expect(snapshot.areas).toHaveLength(1);
  });
});
