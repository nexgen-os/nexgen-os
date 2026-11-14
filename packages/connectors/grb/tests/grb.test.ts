// @nexgen-os/grb, offline: two buildings of a street in Ghent as the GRB
// Web Feature Service gave them, and the surface and terrain models of DHM
// Vlaanderen II over their box as its Web Coverage Service gave them
// (multipart answers, the TIFF in their second part), recorded on
// 2026-11-08. The expected heights were computed from the same files by an
// independent reading (another point-in-polygon rule, the same percentiles).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOF_PERCENTILES, LAMBERT_72, dhmv, grb, grbObjectId, grbSources, heightsInFootprint, readGeoTiff, siteModel,
  type BinaryFetch, type Rings,
} from '../src/index.js';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const gbg = JSON.parse(readFileSync(new URL('./fixtures/gbg.json', import.meta.url), 'utf8')) as {
  features: { properties: { OIDN: number }; geometry: { coordinates: Rings } }[];
};

/** Answers each URL by the service and coverage it names, and keeps what was asked. */
function services(status = 200): { fetch: BinaryFetch; urls: URL[] } {
  const urls: URL[] = [];
  const fetch: BinaryFetch = async (url) => {
    const u = new URL(url);
    urls.push(u);
    const body = u.pathname.includes('/GRB/') ? gbg
      : bytes(u.searchParams.get('CoverageId') === 'DHMVII_DSM_1m' ? 'dsm.bin' : 'dtm.bin');
    return {
      ok: status === 200,
      status,
      json: async () => body,
      arrayBuffer: async () => { const b = body as Uint8Array; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    };
  };
  return { fetch, urls };
}

const AROUND = { lon: 3.72125, lat: 51.054935, radiusM: 4 };

describe('a GeoTIFF of a height model', () => {
  it('is read out of the multipart answer of the coverage service, placed by its tie point, row 0 at the north', () => {
    const r = readGeoTiff(bytes('dsm.bin'));
    expect([r.x0, r.y0, r.dx, r.dy, r.width, r.height]).toEqual([104577, 194075, 1, 1, 52, 33]);
    expect(r.values[0]).toBeCloseTo(10.1, 4);
    expect(r.values[3]).toBeCloseTo(10.06, 4);
    expect(readGeoTiff(bytes('dtm.bin')).values[0]).toBeCloseTo(7.58, 4);
  });

  it('reads a big-endian TIFF in strips, its no-data value as NaN', () => {
    const r = readGeoTiff(stripedBigEndian([[1.5, -9999], [3.25, 4]], '-9999'));
    expect([r.width, r.height, r.x0, r.y0]).toEqual([2, 2, 1000, 2002]);
    expect(Array.from(r.values)).toEqual([1.5, Number.NaN, 3.25, 4]);
  });

  it('refuses by name what it does not read', () => {
    expect(() => readGeoTiff(new TextEncoder().encode('<ows:ExceptionReport/>'))).toThrow(/tiff_not_found/);
    const compressed = stripedBigEndian([[1]], null, 5);
    expect(() => readGeoTiff(compressed)).toThrow(/tiff_unsupported: compressed/);
  });
});

describe('the buildings of GRB', () => {
  it('are asked around a point, latitude first, in Lambert 72, one more than the limit', async () => {
    const api = services();
    const found = await grb({ fetch: api.fetch, limit: 10 }).buildings(AROUND);
    expect(found.map((b) => b.oidn)).toEqual([1361158, 7510815]);
    expect(found[0]).toMatchObject({ uidn: 6516547, type: 'hoofdgebouw', versionDate: '2015-12-02', surveyDate: '2015-10-01' });
    expect(found[0].polygons[0][0].length).toBe(32);
    const q = Object.fromEntries(api.urls[0].searchParams);
    expect(q).toMatchObject({ typeNames: 'GRB:GBG', srsName: 'EPSG:31370', count: '11', outputFormat: 'application/json' });
    const [south, west, north, east, crs] = q.bbox.split(',');
    expect(crs).toBe('urn:ogc:def:crs:EPSG::4326');
    expect(Number(south)).toBeLessThan(AROUND.lat);
    expect(Number(north)).toBeGreaterThan(AROUND.lat);
    expect(Number(west)).toBeLessThan(AROUND.lon);
    expect(Number(east)).toBeGreaterThan(AROUND.lon);
  });

  it('refuses part of a place, a missing radius and a service down, by name', async () => {
    await expect(grb({ fetch: services().fetch, limit: 1 }).buildings(AROUND)).rejects.toThrow(/too_many_buildings/);
    await expect(grb({ fetch: services().fetch }).buildings({ ...AROUND, radiusM: 0 })).rejects.toThrow(/radius_required/);
    await expect(grb({ fetch: services(503).fetch }).buildings(AROUND)).rejects.toThrow(/grb_unavailable: .*503/);
  });
});

describe('the heights of a footprint', () => {
  it('are the median of the terrain under it, and two percentiles of the surface above that ground', async () => {
    const api = services();
    const surface = await dhmv({ fetch: api.fetch }).grid('surface', [104577.67, 194042.54, 104628.15, 194074.28]);
    const terrain = await dhmv({ fetch: api.fetch }).grid('terrain', [104577.67, 194042.54, 104628.15, 194074.28]);
    const asked = Object.fromEntries(api.urls[0].searchParams);
    expect(asked).toMatchObject({ CoverageId: 'DHMVII_DSM_1m', format: 'image/tiff' });
    expect(api.urls[0].searchParams.getAll('subset')).toEqual(['x(104577,104629)', 'y(194042,194075)']);

    const [a, b] = gbg.features.map((f) => [f.geometry.coordinates]);
    expect(heightsInFootprint(a, surface, terrain)).toEqual({ ground: 7.84, eave: 12.08, ridge: 19.18, cells: 430 });
    expect(heightsInFootprint(b, surface, terrain)).toEqual({ ground: 7.73, eave: 10.63, ridge: 18.54, cells: 222 });
    // The percentiles are data: the highest cell, a chimney included.
    expect(heightsInFootprint(a, surface, terrain, { ...DEFAULT_ROOF_PERCENTILES, ridge: 100 })?.ridge).toBe(21.75);
  });

  it('are none for a footprint the grid does not cover', async () => {
    const surface = readGeoTiff(bytes('dsm.bin'));
    const terrain = readGeoTiff(bytes('dtm.bin'));
    const away: Rings = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    expect(heightsInFootprint([away], surface, terrain)).toBeNull();
    expect(() => heightsInFootprint([away], surface, { ...terrain, x0: 0 })).toThrow(/grid_mismatch/);
  });

  it('refuses a box larger than the cells it may ask', async () => {
    await expect(dhmv({ fetch: services().fetch, maxCells: 100 }).grid('surface', [0, 0, 20, 20])).rejects.toThrow(/area_too_large/);
    await expect(dhmv({ fetch: services(500).fetch }).grid('terrain', [0, 0, 2, 2])).rejects.toThrow(/dhmv_unavailable/);
  });
});

describe('a site model', () => {
  it('is a CityJSON model in Lambert 72: each footprint at its ground, its ridge as its height, the rest in its attributes', async () => {
    const api = services();
    const model = await siteModel(AROUND, { fetch: api.fetch });
    expect(model.srid).toBe(LAMBERT_72);
    expect(model.skipped).toEqual([]);
    const [a] = model.buildings;
    expect(a.id).toBe(grbObjectId(1361158));
    expect(a.measuredHeight).toBe(19.18);
    expect(a.zRange).toEqual([7.84, 27.02]);
    expect(a.attributes).toEqual({
      grb: { oidn: 1361158, uidn: 6516547, type: 'hoofdgebouw', version_date: '2015-12-02', survey_date: '2015-10-01' },
      heights: { source: 'dhmv', ground_m: 7.84, eave_m: 12.08, ridge_m: 19.18, cells: 430, percentiles: DEFAULT_ROOF_PERCENTILES },
    });
    // CityJSON rings are open, every point at the ground of its building.
    const ring = a.footprint[0][0];
    expect(ring.length).toBe(31);
    expect(new Set(ring.map((p) => p[2]))).toEqual(new Set([7.84]));
    // One box of the height model for the whole place, both models.
    expect(api.urls.map((u) => u.searchParams.get('CoverageId') ?? 'GRB')).toEqual(['GRB', 'DHMVII_DSM_1m', 'DHMVII_DTM_1m']);
  });

  it('is empty, without asking the height model, where GRB has no building', async () => {
    const urls: string[] = [];
    const empty: BinaryFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ features: [] }), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    expect(await siteModel(AROUND, { fetch: empty })).toEqual({ srid: LAMBERT_72, buildings: [], skipped: [] });
    expect(urls).toHaveLength(1);
  });

  it('ships the two sources it reads, open, for the Flemish region', () => {
    expect(grbSources.map((s) => s.code)).toEqual(['grb', 'dhmv']);
    for (const s of grbSources) {
      expect(s).toMatchObject({ published_by: '@nexgen-os/grb', auth: 'none', redistributable: true, regions: ['BE-VLG'] });
      expect(s.attribution).toMatch(/Digitaal Vlaanderen/);
    }
  });
});

/** A TIFF of 32-bit floats, big-endian, one strip, placed at (1000, 2002) with 1 m cells. */
function stripedBigEndian(rows: number[][], nodata: string | null, compression = 1): Uint8Array {
  const height = rows.length;
  const width = rows[0].length;
  const entries: [number, number, number, number[] | string][] = [
    [256, 3, 1, [width]], [257, 3, 1, [height]], [258, 3, 1, [32]], [259, 3, 1, [compression]],
    [273, 4, 1, [0]], [277, 3, 1, [1]], [278, 3, 1, [height]], [339, 3, 1, [3]],
    [33550, 12, 3, [1, 1, 0]], [33922, 12, 6, [0, 0, 0, 1000, 2002, 0]],
  ];
  if (nodata !== null) entries.push([42113, 2, nodata.length + 1, nodata]);
  const ifd = 8;
  let extra = ifd + 2 + entries.length * 12 + 4;
  const out = new DataView(new ArrayBuffer(4096));
  out.setUint8(0, 0x4d); out.setUint8(1, 0x4d); out.setUint16(2, 42); out.setUint32(4, ifd);
  out.setUint16(ifd, entries.length);
  const dataAt = 2048;
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + i * 12;
    out.setUint16(at, tag); out.setUint16(at + 2, type); out.setUint32(at + 4, count);
    if (typeof value === 'string') {
      const where = value.length + 1 <= 4 ? at + 8 : extra;
      if (where !== at + 8) { out.setUint32(at + 8, extra); extra += value.length + 1; }
      [...value].forEach((ch, k) => out.setUint8(where + k, ch.charCodeAt(0)));
    } else if (type === 12) {
      out.setUint32(at + 8, extra);
      value.forEach((v, k) => out.setFloat64(extra + 8 * k, v));
      extra += 8 * value.length;
    } else if (tag === 273) {
      out.setUint32(at + 8, dataAt);
    } else if (type === 3) {
      out.setUint16(at + 8, value[0]);
    } else {
      out.setUint32(at + 8, value[0]);
    }
  });
  rows.flat().forEach((v, k) => out.setFloat32(dataAt + 4 * k, v));
  return new Uint8Array(out.buffer);
}
