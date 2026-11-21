// `@nexgen-os/connector` is MIT so that a connector runs without the AGPL of
// the core (decision 0064). These tests hold it: its code imports nothing but
// its own files and the MIT computations of `@nexgen-os/solar` (for the type
// of a series point), the core re-exports its names rather than defining them
// again, and the connectors moved onto it no longer import the core.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { azimuthFromSouth } from '@nexgen-os/connector';
import { azimuthFromSouth as coreAzimuthFromSouth } from '@nexgen-os/core';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const manifest = JSON.parse(read('packages/connector/package.json')) as { license: string; dependencies?: Record<string, string> };
const specifiers = (directory: string) =>
  readdirSync(new URL(`${directory}/`, root))
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => [...read(`${directory}/${name}`).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(([, specifier]) => ({ name, specifier })));

describe('the MIT boundary of @nexgen-os/connector', () => {
  it('is MIT, with its own licence file, and depends on the MIT computations only', () => {
    expect(manifest.license).toBe('MIT');
    expect(read('packages/connector/LICENSE')).toMatch(/^MIT License\n/);
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@nexgen-os/solar']);
  });

  it('imports nothing but its own files, the platform and @nexgen-os/solar', () => {
    for (const { name, specifier } of specifiers('packages/connector/src')) {
      expect(specifier, `${name} imports ${specifier}`).toMatch(/^(\.\/|node:|@nexgen-os\/solar$)/);
    }
  });

  it('is the one definition the core re-exports', () => {
    expect(coreAzimuthFromSouth).toBe(azimuthFromSouth);
    expect(read('packages/core/src/connectors/interfaces.ts')).not.toMatch(/export (interface|function) (Point|CollectedSeries|WeatherProvider|azimuthFromSouth)\b/);
    expect(read('packages/core/src/connectors/interfaces.ts')).not.toMatch(/export interface SourceRow\b/);
    expect(read('packages/core/src/address.ts')).not.toMatch(/export (type Fetch =|type Precision =|interface (Address|Place|SearchOptions|Geocoder)\b)/);
  });

  it('is what the weather connectors and the geocoders import, in place of the core', () => {
    for (const connector of ['open-meteo', 'pvgis', 'ban', 'geopunt', 'icar', 'mapbox', 'nominatim', 'photon', 'urbis', 'grb']) {
      const dependencies = Object.keys((JSON.parse(read(`packages/connectors/${connector}/package.json`)) as { dependencies?: Record<string, string> }).dependencies ?? {});
      expect(dependencies, connector).toContain('@nexgen-os/connector');
      expect(dependencies, connector).not.toContain('@nexgen-os/core');
      for (const { name, specifier } of specifiers(`packages/connectors/${connector}/src`)) {
        expect(specifier, `${connector}/${name} imports ${specifier}`).not.toMatch(/^@nexgen-os\/core/);
      }
    }
  });
});

describe('azimuthFromSouth()', () => {
  it('counts the azimuth from south, west positive, in (-180, 180]', () => {
    expect(azimuthFromSouth(180)).toBe(0);
    expect(azimuthFromSouth(270)).toBe(90);
    expect(azimuthFromSouth(90)).toBe(-90);
    expect(azimuthFromSouth(0)).toBe(180);
    expect(azimuthFromSouth(360)).toBe(180);
    expect(azimuthFromSouth(-45)).toBe(135);
  });
});
