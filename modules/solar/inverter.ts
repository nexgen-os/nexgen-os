// An inverter described by its PVsyst OND file, as a model an engine runs.
//
// An OND file gives the inverter's efficiency as curves of AC output against
// DC input, usually at three DC voltages (`ProfilPIOV1…3` at `VNomEff`), else
// one (`ProfilPIO`). The Sandia inverter model (King et al., SAND2007-5036)
// is fitted on those curves exactly as pvlib's `inverter.fit_sandia` fits it
// on a CEC test report: at each voltage a quadratic of AC against DC power,
// the DC power that gives the rated AC power and the one that gives none,
// then a line of each against the voltage. The fit is computed when a run
// needs it and recorded with the run; the product keeps the file's curves.

/** The parameters of the Sandia inverter model, in pvlib's keys. */
export interface SandiaInverter {
  /** AC power rating, W. */
  Paco: number;
  /** DC power at which the rated AC power is reached at Vdco, W. */
  Pdco: number;
  /** DC voltage of the nominal curve, V. */
  Vdco: number;
  /** DC power needed to start the inversion, W. */
  Pso: number;
  /** Curvature of AC against DC power, 1/W. */
  C0: number;
  /** How Pdco, Pso and C0 change with the DC voltage, 1/V. */
  C1: number;
  C2: number;
  C3: number;
  /** AC power drawn at night, W. */
  Pnt: number;
}

type Curve = [number, number][];

/**
 * The Sandia model of an inverter of model `ond`, from the OND keys as the
 * PAN/OND reader gives them: `Converter.PMaxOUT` (kW) as the rating,
 * `Night_Loss` (W) as the night draw, the curves as [DC W, AC W] points.
 * Named error `ond_without_curves` when the file has no usable curve.
 */
export function sandiaFromOnd(ond: Record<string, unknown>): SandiaInverter {
  const converter = (ond.Converter ?? {}) as Record<string, unknown>;
  const kw = typeof converter.PMaxOUT === 'number' ? converter.PMaxOUT : converter.PNomConv;
  if (typeof kw !== 'number' || !(kw > 0)) throw new Error('ond_without_curves: the file gives no maximum AC power (PMaxOUT, PNomConv)');
  const paco = kw * 1000;
  const pnt = typeof ond.Night_Loss === 'number' ? ond.Night_Loss : 0;

  const voltages = Array.isArray(converter.VNomEff) ? (converter.VNomEff as number[]) : [];
  const perVoltage = [1, 2, 3].map((n) => curvePoints(converter[`ProfilPIOV${n}`]));
  const levels = voltages.length >= 3 && perVoltage.every((c) => c.length >= 3)
    ? perVoltage.map((curve, i) => ({ voltage: voltages[i], curve }))
    : [{ voltage: voltages[1] ?? midRange(converter), curve: curvePoints(converter.ProfilPIO) }];
  if (levels.some((l) => l.curve.length < 3 || !Number.isFinite(l.voltage))) {
    throw new Error('ond_without_curves: the file has no efficiency curve of three points or more with its voltage');
  }

  const fitted = levels.map(({ curve }) => {
    const [c, b, a] = polyfit(curve.map((p) => p[0]), curve.map((p) => p[1]), 2);
    return { a, pdc: solveQuadratic(a, b, c - paco), ps0: solveQuadratic(a, b, c) };
  });
  const vnom = levels.length === 3 ? levels[1].voltage : levels[0].voltage;
  if (levels.length === 1) {
    return { Paco: paco, Pdco: fitted[0].pdc, Vdco: vnom, Pso: fitted[0].ps0, C0: fitted[0].a, C1: 0, C2: 0, C3: 0, Pnt: pnt };
  }
  const x = levels.map((l) => l.voltage - vnom);
  const line = (y: number[]) => {
    const [beta0, beta1] = polyfit(x, y, 1);
    return { beta0, c: beta1 / beta0 };
  };
  const dc = line(fitted.map((f) => f.pdc));
  const s0 = line(fitted.map((f) => f.ps0));
  const c0 = line(fitted.map((f) => f.a));
  return { Paco: paco, Pdco: dc.beta0, Vdco: vnom, Pso: s0.beta0, C0: c0.beta0, C1: dc.c, C2: s0.c, C3: c0.c, Pnt: pnt };
}

/** The points of a curve block with power out: below the threshold the inverter is off. */
function curvePoints(block: unknown): Curve {
  if (!block || typeof block !== 'object') return [];
  const b = block as Record<string, unknown>;
  const count = typeof b.NPtsEff === 'number' ? b.NPtsEff : Infinity;
  const out: Curve = [];
  for (let n = 1; n <= count; n++) {
    const p = b[`Point_${n}`];
    if (!Array.isArray(p) || p.length < 2) break;
    if (p[1] > 0) out.push([p[0], p[1]]);
  }
  return out;
}

function midRange(converter: Record<string, unknown>): number {
  const lo = converter.VMppMin;
  const hi = converter.VMPPMax;
  return typeof lo === 'number' && typeof hi === 'number' ? (lo + hi) / 2 : NaN;
}

/** pvlib's root: the larger one when the curvature is negative, as an inverter's is. */
function solveQuadratic(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-15) return -c / b;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/**
 * Least-squares polynomial of a degree, coefficients from the constant up
 * (as numpy.polynomial.polynomial.polyfit), by the normal equations: the
 * degrees here are one and two, on a handful of points.
 */
export function polyfit(x: number[], y: number[], degree: number): number[] {
  const n = degree + 1;
  // Scale x to keep the normal equations well conditioned on powers in watts.
  const scale = Math.max(...x.map(Math.abs)) || 1;
  const xs = x.map((v) => v / scale);
  const m: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (j === n) return xs.reduce((s, v, k) => s + v ** i * y[k], 0);
    return xs.reduce((s, v) => s + v ** (i + j), 0);
  }));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i] / scale ** i);
}
