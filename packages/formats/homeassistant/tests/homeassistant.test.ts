// A Home Assistant snapshot read into plain shapes and written back, with no
// database: the shapes say what the snapshot says, and nothing is lost.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readHomeAssistant, writeHomeAssistant, type HaSnapshot } from '@nexgen-os/homeassistant';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/home.json', import.meta.url), 'utf8')) as HaSnapshot;

describe('a Home Assistant snapshot', () => {
  const home = readHomeAssistant(snapshot);

  it('reads floors and areas as one tree of spaces, devices in their rooms', () => {
    expect(home.spaces.map((s) => [s.kind, s.key, s.parent, s.level])).toEqual([
      ['floor', 'ground', null, 0], ['floor', 'first', null, 1],
      ['room', 'living_room', 'ground', null], ['room', 'kitchen', 'ground', null], ['room', 'bedroom', 'first', null], ['room', 'garage', null, null],
    ]);
    expect(home.devices.map((d) => [d.key, d.name, d.space, d.serialNumber])).toEqual([
      ['dev-inverter', 'Inverter', 'garage', 'HV2240012345'],
      ['dev-thermostat', 'Living room thermostat', 'living_room', null],
      ['dev-relay', 'Netatmo relay', null, null],
    ]);
  });

  it('reads each entity as a point with its class and unit as stated, its role and its kind of value', () => {
    const byKey = new Map(home.points.map((p) => [p.key, p]));
    expect(byKey.get('sensor.inverter_active_power')).toMatchObject({ deviceClass: 'power', unit: 'W', role: 'measured', valueKind: 'instant', binary: false });
    expect(byKey.get('sensor.inverter_total_yield')).toMatchObject({ unit: 'kWh', valueKind: 'cumulative' });
    expect(byKey.get('climate.living_room')).toMatchObject({ deviceClass: null, role: 'setpoint' });
    expect(byKey.get('switch.garage_heater')).toMatchObject({ role: 'command', binary: true });
    expect(byKey.get('binary_sensor.bedroom_motion')?.deviceClass).toBe('occupancy');
  });

  it('reads states as readings: on and off as 1 and 0, unavailable as null, no unit converted', () => {
    const readings = (key: string) => home.points.find((p) => p.key === key)?.readings.map((r) => r.value);
    expect(readings('sensor.inverter_active_power')).toEqual([2345, 3120.5, null]);
    expect(readings('binary_sensor.bedroom_motion')).toEqual([1, 0]);
    expect(readings('sensor.outdoor_noise')).toEqual([41]);
  });

  it('writes the shapes back as the snapshot it read', () => {
    expect(writeHomeAssistant(home)).toEqual(snapshot);
  });

  it('flattens unknown into unavailable, and nothing else', () => {
    const unknown = { ...snapshot, states: [{ entity_id: 'sensor.kitchen_co2', state: 'unknown', last_updated: '2026-06-21T10:00:00.000Z' }] };
    expect(writeHomeAssistant(readHomeAssistant(unknown)).states).toEqual([{ ...unknown.states[0], state: 'unavailable' }]);
  });
});
