// An inverter known by its OND file runs as the Sandia model, fitted on the
// file's efficiency curves exactly as pvlib's `inverter.fit_sandia` fits it.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { polyfit, sandiaFromOnd } from '../modules/solar/inverter.js';
import { repoRoot } from './helpers/db.js';

/** A 10 kW inverter as the PAN/OND reader gives it: three curves of [DC W, AC W] at three voltages. */
const ond = JSON.parse(await readFile(`${repoRoot}/tests/fixtures/ond-inverter-10kw.json`, 'utf8'));

/** What pvlib 0.16.1 `inverter.fit_sandia` answers on the same points (AC > 0), Paco 11 000 W, Pnt 1.5 W. */
const PVLIB = { Paco: 11000, Pdco: 11263.165096719893, Vdco: 600, Pso: 20.970587825498193, C0: -9.885973902690624e-7, C1: -5.4881473236623085e-6, C2: -0.0003984050855122185, C3: -0.0004321247061550824, Pnt: 1.5 };

describe('the Sandia model of an OND inverter', () => {
  it('fits the three curves as pvlib does', () => {
    const fitted = sandiaFromOnd(ond);
    for (const [key, value] of Object.entries(PVLIB)) {
      expect(fitted[key as keyof typeof PVLIB] / value, key).toBeCloseTo(1, 7);
    }
  });

  it('fits the one curve of a file without voltage curves, the voltage terms left at zero', () => {
    const { ProfilPIOV1, ProfilPIOV2, ProfilPIOV3, VNomEff, ...single } = ond.Converter;
    const fitted = sandiaFromOnd({ ...ond, Converter: single });
    expect([fitted.C1, fitted.C2, fitted.C3, fitted.Vdco]).toEqual([0, 0, 0, 555]); // the middle of the MPP range
    // numpy's polyfit and the same root on the one curve
    expect(fitted.Pdco / 11223.676550179418).toBeCloseTo(1, 7);
    expect(fitted.Pso / 14.18899537933326).toBeCloseTo(1, 7);
    expect(fitted.C0 / -7.328449691239893e-7).toBeCloseTo(1, 7);
  });

  it('refuses a file without a usable curve, by name', () => {
    expect(() => sandiaFromOnd({ Converter: { PMaxOUT: 11 } })).toThrow(/^ond_without_curves/);
    expect(() => sandiaFromOnd({ Converter: { ProfilPIO: ond.Converter.ProfilPIO } })).toThrow(/^ond_without_curves/);
  });

  it('fits polynomials from the constant up, as numpy does', () => {
    expect(polyfit([0, 1, 2, 3], [1, 3, 5, 7], 1).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 2]);
    expect(polyfit([1000, 2000, 3000, 4000], [3, 10, 21, 36].map((v) => v * 1e6), 2).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 1000, 2]);
  });
});
