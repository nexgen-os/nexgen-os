// A place in Flanders described from open data, end to end and offline:
// the buildings GRB draws around a point, their heights from DHM Vlaanderen
// II, written by the CityJSON importer of the `building` module as the
// buildings of a participant, with the sources the connector ships.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { registerSource } from '@nexgen-os/core';
import { grbObjectId, grbSources, siteModel, type BinaryFetch } from '@nexgen-os/grb';
import { importCityJson } from '../modules/building/src/index.js';
import { USER_A, freshDatabase, one, organisation, participant, repoRoot } from './helpers/db.js';

const fixture = (name: string) => readFileSync(`${repoRoot}/packages/connectors/grb/tests/fixtures/${name}`);

const recorded: BinaryFetch = async (url) => {
  const u = new URL(url);
  const body = u.pathname.includes('/GRB/') ? fixture('gbg.json')
    : fixture(u.searchParams.get('CoverageId') === 'DHMVII_DSM_1m' ? 'dsm.bin' : 'dtm.bin');
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body.toString('utf8')) as unknown,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  };
};

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  const org = await organisation(db, 'A street in Ghent', USER_A);
  owner = await participant(db, { organisation_id: org, name: 'Corner house', country: 'BE', time_zone: 'Europe/Brussels' });
  for (const row of grbSources) await registerSource(db, row);
});

afterAll(async () => {
  await db.close();
});

describe('a site model from GRB and DHM Vlaanderen II', () => {
  it('lands as the buildings of a participant: footprint in WGS 84, ground as elevation, ridge as height, GRB id as identifier', async () => {
    const model = await siteModel({ lon: 3.72125, lat: 51.054935, radiusM: 4 }, { fetch: recorded });
    const r = await importCityJson(db, { participantId: owner }, model, { sourceCode: 'grb', use: 'residential' });
    expect(r.buildings.map((b) => b.cityObjectId)).toEqual([grbObjectId(1361158), grbObjectId(7510815)]);
    expect(r.surfaces).toBe(0);

    const b = await one<{ elevation: number; height: number; source: string; ext: string; eave: number; area: number; grbArea: number; lon: number; lat: number }>(
      db,
      `select b.elevation_m::float elevation, b.height_m::float height, b.source_code source, b.global_id ext,
              (b.metadata->'cityjson'->'attributes'->'heights'->>'eave_m')::float eave,
              area_m2(b.footprint)::float area,
              ST_Area(ST_Transform(b.footprint, 31370))::float "grbArea",
              ST_X(ST_Centroid(b.footprint)) lon, ST_Y(ST_Centroid(b.footprint)) lat
         from building.buildings b where b.global_id = $1`,
      [grbObjectId(1361158)],
    );
    expect(b).toMatchObject({ elevation: 7.84, height: 19.18, source: 'grb', ext: 'GRB.GBG.1361158', eave: 12.08 });
    // The footprint keeps the area GRB draws (shoelace over the recorded ring, in Lambert 72).
    expect(b.grbArea).toBeCloseTo(shoelace(), 1);
    expect(b.area).toBeCloseTo(b.grbArea, -1);
    expect(b.lon).toBeCloseTo(3.7212, 3);
    expect(b.lat).toBeCloseTo(51.0549, 3);
  });

  it('is imported once: the same place again is refused by name', async () => {
    const model = await siteModel({ lon: 3.72125, lat: 51.054935, radiusM: 4 }, { fetch: recorded });
    await expect(importCityJson(db, { participantId: owner }, model, { sourceCode: 'grb' })).rejects.toThrow(/already_imported/);
  });

  it('names its sources with their licence and attribution', async () => {
    const s = await one<{ n: number }>(db, `select count(*)::int n from sources where code in ('grb', 'dhmv') and license = 'Modellicentie Gratis Hergebruik' and published_by = '@nexgen-os/grb'`);
    expect(s.n).toBe(2);
  });
});

function shoelace(): number {
  const gbg = JSON.parse(fixture('gbg.json').toString('utf8')) as { features: { geometry: { coordinates: number[][][] } }[] };
  const ring = gbg.features[0].geometry.coordinates[0];
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
}
