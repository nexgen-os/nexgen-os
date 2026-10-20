// An IFC4 model read into plain shapes with no database: placed by its map
// conversion, else its site's coordinates, else the origin given; its
// building, storeys, spaces, roof face and equipment in metres in the
// reference system it is placed in; what it did not read, by reason.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readIfc, sridOf } from '@nexgen-os/ifc';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url)).then((b) => new Uint8Array(b));

const mapped = await readIfc(await fixture('ifc-house-map-conversion.ifc'));
const equipped = await readIfc(await fixture('ifc-house-equipment.ifc'));

describe('an IFC4 model with an IfcMapConversion', () => {
  const model = mapped;
  const [b] = model.buildings;

  it('is placed in RD New by its map conversion, the site at its false origin', () => {
    expect(model.schema).toBe('IFC4');
    expect(model.georeference).toMatchObject({ kind: 'map_conversion', crs: 'EPSG:28992', srid: 28992, proj: null });
    expect(model.site.origin.map((c) => Math.round(c))).toEqual([121000, 487000, 0]);
    expect(model.site.description).toMatchObject({ entity: 'IfcSite' });
  });

  it('reads the building, its storeys and rooms in metres, and its year as the file says it', () => {
    expect(b).toMatchObject({ globalId: '0K7w7JWBL5QOdBzu3Yz7Ts', name: 'Canal house', elevation: 0, yearOfConstruction: 1962 });
    expect(b.height).toBeCloseTo(9.464, 3);
    expect(b.footprint.source).toBe('slabs');
    expect(b.floors.map((f) => [f.name, f.level, f.elevation, f.height, f.rooms.map((r) => [r.name, r.area])])).toEqual([
      ['00 Ground floor', 0, 0, 3, [['Living room', 32.5], ['Kitchen', 18]]],
      ['01 First floor', 1, 3, 6.464, [['1.01', 40]]],
    ]);
    expect(b.rooms).toEqual([]);
  });

  it('reads the roof slab as one face that looks up, in the target reference system', () => {
    expect(b.roofs).toHaveLength(1);
    const [roof] = b.roofs;
    expect(roof).toMatchObject({ globalId: '3Rf0Sl1Ab2Cd3Ef4Gh5Ij6', name: 'Roof' });
    const zs = roof.rings[0].map((p) => p[2]);
    expect(Math.min(...zs)).toBeCloseTo(6, 3);
    expect(Math.max(...zs)).toBeCloseTo(9.464, 3);
    expect(roof.rings[0].every((p) => Math.abs(p[0] - 121000) < 20 && Math.abs(p[1] - 487000) < 20)).toBe(true);
  });

  it('leaves the device types to its reader: a tree is a product, the base slab is skipped as read for the footprint', () => {
    expect(model.products.map((p) => p.entity)).toEqual(['IfcGeographicElement']);
    expect(model.skipped).toEqual([{ entity: 'IfcSlab', count: 1, reason: 'read for the footprint only' }]);
  });
});

describe('an IFC4 model with its equipment', () => {
  const model = equipped;

  it('gives each product its class, predefined type, nameplate and the building and room that contain it', () => {
    const battery = model.products.find((p) => p.entity === 'IfcElectricFlowStorageDevice');
    expect(battery).toMatchObject({ building: model.buildings[0].globalId });
    expect(battery?.manufacturer).not.toBeNull();
    expect(battery?.serialNumber).not.toBeNull();
    const turbine = model.products.find((p) => p.building === null && p.entity !== 'IfcGeographicElement');
    expect(turbine).toBeDefined();
  });
});

describe('an IFC4 model without a map conversion', () => {
  it('is placed by its site coordinates, in a local transverse Mercator, with walls for a footprint', async () => {
    const model = await readIfc(await fixture('ifc-house-site-coordinates.ifc'));
    expect(model.georeference.kind).toBe('site_coordinates');
    expect(model.georeference.srid).toBeNull();
    expect(model.georeference.proj).toMatch(/^\+proj=tmerc /);
    expect(model.buildings[0].footprint.source).toBe('walls');
  });

  it('needs an origin when it has no site coordinates either, and refuses what is not IFC, by name', async () => {
    const text = new TextDecoder().decode(await fixture('ifc-house-site-coordinates.ifc')).replace('(52,22,11,374355),(4,53,16,694753),0.', '$,$,$');
    const placeless = new TextEncoder().encode(text);
    await expect(readIfc(placeless)).rejects.toThrow(/^georeference_missing/);
    const placed = await readIfc(placeless, { origin: { lon: 4.887971, lat: 52.369826, rotationDeg: 30 } });
    expect(placed.georeference.kind).toBe('none');
    await expect(readIfc(new TextEncoder().encode('not a STEP file'))).rejects.toThrow(/^not_ifc/);
  });

  it('reads EPSG codes from CRS names', () => {
    expect(sridOf('EPSG:28992')).toBe(28992);
    expect(sridOf('a local grid')).toBeNull();
  });
});
