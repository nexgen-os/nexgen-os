// The figures of the README are drawn from data by `docs/images/render.mjs`:
// each committed SVG is its render, the yield figure is the estimate the
// `solar` module computed for the house of example 01, and the README shows both.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderFigures } from '../docs/images/render.js';
import { repoRoot } from './helpers/db.js';

const images = join(repoRoot, 'docs', 'images');

describe('the figures of the README', () => {
  it('are the render of their data: run npx tsx docs/images/render.ts and commit the result', async () => {
    for (const [name, svg] of Object.entries(renderFigures())) {
      expect(await readFile(join(images, name), 'utf8'), name).toBe(svg);
    }
  });

  it('draw the yield of the house of example 01 as the solar module recorded it', async () => {
    const report = JSON.parse(await readFile(join(images, 'monthly-yield.json'), 'utf8'));
    expect(report.system.deviceId).toBe('00000000-0000-4000-8000-000100000051');
    expect(report.months).toHaveLength(12);
    const total = report.months.reduce((s: number, m: { kwh: number }) => s + m.kwh, 0);
    expect(total).toBeCloseTo(report.annualKwh, 0);
    expect(report.provenance).toMatch(/^pvgis-[\d.]+\+solar-[\d.]+$/);
  });

  it('are shown by the README, each with its text alternative', async () => {
    const readme = await readFile(join(repoRoot, 'README.md'), 'utf8');
    for (const name of Object.keys(renderFigures())) expect(readme).toMatch(new RegExp(`!\\[[^\\]]+\\]\\(docs/images/${name}\\)`));
  });
});
