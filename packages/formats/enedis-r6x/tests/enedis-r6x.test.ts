// @nexgen-os/enedis-r6x: R63 and R64 files read into steps at their start in
// UTC, with the zone and the quality table of the caller. The fixtures are
// built after the structure of the Enedis R6X guide (enedis.fr/media/3751),
// with invented metering points and values.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { durationMs, instantsOf, parseXml, readR6x, type R6xOptions } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// The table and the zone a French pack gives; data of the test, never of the library.
const options: R6xOptions = {
  timeZone: 'Europe/Paris',
  qualityCodes: { B: 0, R: 0, E: 1, C: 2, D: 100, H: 101, P: 102, S: 103, T: 104, F: 105, G: 106, missing: 3, none: 0 },
};

describe('an R63 load curve', () => {
  it('dates each step at its start in UTC, in the unit of the file, with the quality of its letter', () => {
    const file = readR6x(fixture('r63-30min-day.json'), options);
    expect(file.problems).toEqual([]);
    expect(file.header).toMatchObject({ codeFlux: 'R63', idDemande: 'M0A00001' });
    const [curve] = file.series;
    expect(curve).toMatchObject({ prm: '00000000000001', stage: 'BRUT', business: 'CONS', physical: 'PA', unit: 'W', kind: 'load_curve', step: 'PT30M' });
    expect(curve!.points).toHaveLength(48);
    expect(curve!.points[0]).toEqual({
      start: '2026-01-14T23:00:00.000Z', local: '2026-01-15 00:00:00', value: 400, nature: 'R', quality: 0, correction: null, likelihood: null, state: null,
    });
    expect(curve!.points.slice(20, 23).map((p) => [p.nature, p.quality, p.correction, p.likelihood])).toEqual([['E', 1, null, null], ['C', 2, '1', null], ['R', 0, null, '1']]);
    expect(curve!.points.at(-1)!.start).toBe('2026-01-15T22:30:00.000Z');
  });

  it('reads the same file in XML into the same series', () => {
    expect(readR6x(fixture('r63-30min-day.xml'), options).series).toEqual(readR6x(fixture('r63-30min-day.json'), options).series);
  });

  it('has 46 half hours on the day the clocks go forward', () => {
    const [curve] = readR6x(fixture('r63-dst-march.json'), options).series;
    expect(curve!.points).toHaveLength(46);
    expect(curve!.points.every((p) => p.quality === 0)).toBe(true);
    expect(curve!.points.slice(3, 5).map((p) => [p.local, p.start])).toEqual([
      ['2026-03-29 01:30:00', '2026-03-29T00:30:00.000Z'], ['2026-03-29 03:00:00', '2026-03-29T01:00:00.000Z'],
    ]);
  });

  it('has 50 half hours on the day the clocks go back, the repeated hour told apart by the order of the lines', () => {
    const [curve] = readR6x(fixture('r63-dst-october.json'), options).series;
    expect(curve!.points).toHaveLength(50);
    expect(curve!.points.slice(4, 8).map((p) => [p.local, p.start, p.value])).toEqual([
      ['2026-10-25 02:00:00', '2026-10-25T00:00:00.000Z', 2004],
      ['2026-10-25 02:30:00', '2026-10-25T00:30:00.000Z', 2005],
      ['2026-10-25 02:00:00', '2026-10-25T01:00:00.000Z', 2006],
      ['2026-10-25 02:30:00', '2026-10-25T01:30:00.000Z', 2007],
    ]);
    expect(curve!.points.slice(6, 8).map((p) => p.quality)).toEqual([101, 101]);
    expect(new Set(curve!.points.map((p) => p.start)).size).toBe(50);
  });

  it('keeps the five-minute step, the reactive power, the outage letters, and a step lost as missing', () => {
    const file = readR6x(fixture('r63-5min-reactive-outage.json'), options);
    expect(file.problems).toEqual([]);
    const [pa, pri, injection] = file.series;
    expect([pa!.physical, pa!.unit, pa!.step, pri!.physical, pri!.unit, injection!.business]).toEqual(['PA', 'W', 'PT5M', 'PRI', 'VAr', 'PROD']);
    expect(pa!.points).toHaveLength(24);
    expect(pa!.points.slice(9, 16).map((p) => [p.nature, p.quality])).toEqual([
      ['F', 105], ['S', 103], ['T', 104], ['G', 106], [null, 3], ['P', 102], ['D', 100],
    ]);
    expect(pa!.points[13]).toMatchObject({ start: '2026-06-10T09:05:00.000Z', local: null, quality: 3 });
    expect(Number.isNaN(pa!.points[13]!.value)).toBe(true);
    expect(pri!.points[0]).toMatchObject({ start: '2026-06-10T08:00:00.000Z', value: 8000 });
  });
});

describe('an R64 index', () => {
  it('reads each dial of each calendar as readings at their instant', () => {
    const file = readR6x(fixture('r64-index.json'), options);
    expect(file.problems).toEqual([]);
    expect(file.series.map((s) => [s.kind, s.physical, s.unit, s.calendar, s.time_class, s.dial, s.points.length])).toEqual([
      ['index', 'EA', 'Wh', 'DI000002', 'HP', 'D1', 2], ['index', 'EA', 'Wh', 'DI000002', 'HC', 'D2', 2],
    ]);
    expect(file.series[0]!.points[1]).toMatchObject({ start: '2026-01-15T23:00:00.000Z', value: 1531100, quality: 0 });
  });
});

describe('what the reader never guesses', () => {
  it('refuses a stamp without an offset when no zone is given, and names a letter its table does not hold', () => {
    const noZone = readR6x(fixture('r63-30min-day.json'), { qualityCodes: options.qualityCodes });
    expect(noZone.problems[0]!.code).toBe('time_zone_required');
    const noTable = readR6x(fixture('r63-30min-day.json'), { timeZone: 'Europe/Paris', qualityCodes: { R: 0, missing: 3 } });
    expect(new Set(noTable.problems.map((p) => p.code))).toEqual(new Set(['quality_unknown']));
    expect(noTable.series[0]!.points[20]!.quality).toBeNull();
  });

  it('reports a file it cannot read, and one without measures', () => {
    expect(readR6x('{ not json', options).problems[0]!.code).toBe('file_unreadable');
    expect(readR6x('<R63><header/>', options).problems[0]!.code).toBe('file_unreadable');
    expect(readR6x({ header: {}, mesures: [] }, options).problems).toEqual([{ code: 'no_measures', detail: 'the file holds no measures' }]);
  });

  it('turns wall-clock time into instants in any zone, and reads the steps of the format', () => {
    expect(instantsOf('America/New_York', Date.UTC(2026, 10, 1, 1, 30)).map((t) => new Date(t).toISOString()))
      .toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']);
    expect(instantsOf('America/New_York', Date.UTC(2026, 2, 8, 2, 30))).toEqual([]);
    expect([durationMs('PT5M'), durationMs('PT1H'), durationMs('P1D'), durationMs('P1M')]).toEqual([300_000, 3_600_000, 86_400_000, null]);
    expect(parseXml('<a:b xmlns:a="x"><c k="1">t &amp; u</c></a:b>')).toEqual({
      name: 'b', attributes: { a: 'x' }, text: '', children: [{ name: 'c', attributes: { k: '1' }, children: [], text: 't & u' }],
    });
  });
});
