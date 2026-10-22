// The figures of the README, drawn from data rather than by hand, in day
// mode:
//
//   npx tsx docs/images/render.ts
//
// - `model.svg`: the six objects of the core, in the order a page walks them;
// - `monthly-yield.svg`: the yield of the house of example 01 by month, from
//   `monthly-yield.json`, the figure the `solar` module computed, with its
//   provenance in the caption.
//
// The test suite renders both again and compares them with the committed
// files (`tests/readme-figures.test.ts`).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#8a8984', rule: '#e4e3df' };
const SURFACE = '#fcfcfb';
const SERIES = '#2a78d6';

/** What `monthly-yield.json` holds: the estimate's figures and what it says it was computed from. */
export interface YieldReport {
  participant: { name: string; city: string; country: string };
  system: { deviceId: string; kwp: number; arrays: { name: string; azimuthDeg: number; tiltDeg: number }[] };
  year: number;
  annualKwh: number;
  kwhPerKwp: number;
  months: { month: string; kwh: number }[];
  provenance: string;
  weather: { radiation_db?: string; meteo_db?: string; horizon?: string } | null;
}

const escape = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The six objects of the core and their foreign keys: what the README says in words. */
export function modelSvg(): string {
  const w = 800;
  const h = 210;
  const box = (x: number, y: number, title: string, line: string): string => [
    `  <rect x="${x}" y="${y}" width="128" height="52" rx="8" fill="#ffffff" stroke="${INK.rule}" stroke-width="1.5"/>`,
    `  <text x="${x + 64}" y="${y + 23}" text-anchor="middle" font-size="14" font-weight="600" fill="${INK.primary}">${title}</text>`,
    `  <text x="${x + 64}" y="${y + 40}" text-anchor="middle" font-size="11" fill="${INK.secondary}">${line}</text>`,
  ].join('\n');
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, lx: number, ly: number): string => [
    `  <path d="M${x1} ${y1} L${x2} ${y2}" stroke="${INK.muted}" stroke-width="1.5" fill="none" marker-end="url(#head)"/>`,
    label ? `  <text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="${INK.muted}">${label}</text>` : '',
  ].filter(Boolean).join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT} role="img" aria-labelledby="t">`,
    `  <title id="t">The model in one screen: an organisation works on projects; participants take part in a project; a participant carries meters and has devices behind them; meters and devices have series.</title>`,
    `  <defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${INK.muted}"/></marker></defs>`,
    `  <rect width="${w}" height="${h}" rx="12" fill="${SURFACE}"/>`,
    box(16, 79, 'Organisation', 'owns the data'),
    box(214, 79, 'Project', 'a community, a study'),
    box(412, 79, 'Participant', 'the node, its place'),
    box(586, 24, 'Meter', 'its connection point'),
    box(586, 134, 'Device', 'behind the meter'),
    arrow(146, 105, 212, 105, 'works on', 179, 95),
    arrow(344, 105, 410, 105, 'takes part', 377, 95),
    arrow(542, 96, 584, 56, 'carries', 548, 64),
    arrow(542, 114, 584, 154, 'has', 552, 150),
    `  <rect x="736" y="79" width="56" height="52" rx="8" fill="#ffffff" stroke="${INK.rule}" stroke-width="1.5"/>`,
    `  <text x="764" y="110" text-anchor="middle" font-size="14" font-weight="600" fill="${INK.primary}">Series</text>`,
    `  <path d="M714 50 C 726 50, 730 80, 736 92" stroke="${INK.muted}" stroke-width="1.5" fill="none" marker-end="url(#head)"/>`,
    `  <path d="M714 160 C 726 160, 730 130, 736 118" stroke="${INK.muted}" stroke-width="1.5" fill="none" marker-end="url(#head)"/>`,
    '</svg>',
  ].join('\n') + '\n';
}

/** A column per month, from one baseline, the year's total and the estimate's provenance in the caption. */
export function monthlyYieldSvg(report: YieldReport): string {
  const w = 800;
  const h = 320;
  const left = 56;
  const right = 16;
  const top = 84;
  const bottom = 240;
  const months = report.months;
  const max = Math.max(...months.map((m) => m.kwh));
  const step = 200;
  const ceiling = Math.ceil(max / step) * step;
  const y = (v: number): number => bottom - (v / ceiling) * (bottom - top);
  const band = (w - left - right) / months.length;
  const bar = Math.min(24, band - 8);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The highest and the lowest month carry their value; the others are read on the grid.
  const high = [...months].sort((a, b) => b.kwh - a.kwh)[0]?.month;
  const low = [...months].sort((a, b) => a.kwh - b.kwh)[0]?.month;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT} role="img" aria-labelledby="t">`,
    `  <title id="t">Yield by month in ${report.year} of a ${report.system.kwp} kWp PV system in ${escape(report.participant.city)}: ${months.map((m) => `${m.month} ${m.kwh} kWh`).join(', ')}.</title>`,
    `  <rect width="${w}" height="${h}" rx="12" fill="${SURFACE}"/>`,
    `  <text x="${left}" y="30" font-size="15" font-weight="600" fill="${INK.primary}">Yield by month, ${report.year} — ${report.system.kwp} kWp in ${escape(report.participant.city)}, ${report.system.arrays.map((a) => `azimuth ${a.azimuthDeg}° from north, tilt ${a.tiltDeg}°`).join('; ')}</text>`,
    `  <text x="${left}" y="48" font-size="12" fill="${INK.secondary}">${Math.round(report.annualKwh).toLocaleString('en-US')} kWh in the year, ${Math.round(report.kwhPerKwp).toLocaleString('en-US')} kWh/kWp</text>`,
  ];
  for (let v = 0; v <= ceiling; v += step) {
    lines.push(`  <line x1="${left}" y1="${y(v).toFixed(1)}" x2="${w - right}" y2="${y(v).toFixed(1)}" stroke="${INK.rule}" stroke-width="1"/>`);
    lines.push(`  <text x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${INK.muted}">${v}</text>`);
  }
  lines.push(`  <text x="${left - 8}" y="${top - 18}" text-anchor="end" font-size="11" fill="${INK.muted}">kWh</text>`);
  months.forEach((m, i) => {
    const x = left + band * i + (band - bar) / 2;
    const yt = y(m.kwh);
    const r = 4;
    lines.push(`  <path d="M${x.toFixed(1)} ${bottom} V${(yt + r).toFixed(1)} Q${x.toFixed(1)} ${yt.toFixed(1)} ${(x + r).toFixed(1)} ${yt.toFixed(1)} H${(x + bar - r).toFixed(1)} Q${(x + bar).toFixed(1)} ${yt.toFixed(1)} ${(x + bar).toFixed(1)} ${(yt + r).toFixed(1)} V${bottom} Z" fill="${SERIES}"><title>${m.month}: ${m.kwh} kWh</title></path>`);
    const month = Number(m.month.slice(5, 7)) - 1;
    lines.push(`  <text x="${(x + bar / 2).toFixed(1)}" y="${bottom + 16}" text-anchor="middle" font-size="11" fill="${INK.secondary}">${names[month]}</text>`);
    if (m.month === high || m.month === low) {
      lines.push(`  <text x="${(x + bar / 2).toFixed(1)}" y="${(yt - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="${INK.primary}">${Math.round(m.kwh)}</text>`);
    }
  });
  lines.push(`  <line x1="${left}" y1="${bottom}" x2="${w - right}" y2="${bottom}" stroke="${INK.muted}" stroke-width="1"/>`);
  const weather = report.weather ?? {};
  lines.push(`  <text x="${left}" y="${h - 30}" font-size="11" fill="${INK.muted}">An estimate of the solar module, computed by ${escape(report.provenance)}, months in UTC.</text>`);
  lines.push(`  <text x="${left}" y="${h - 14}" font-size="11" fill="${INK.muted}">Irradiance ${escape(weather.radiation_db ?? '-')}, weather ${escape(weather.meteo_db ?? '-')}, horizon ${escape(weather.horizon ?? '-')}.</text>`);
  return `${lines.join('\n')}\n</svg>\n`;
}

/** Both figures, by the name of their file. */
export function renderFigures(): Record<string, string> {
  const report = JSON.parse(readFileSync(`${here}monthly-yield.json`, 'utf8')) as YieldReport;
  return { 'model.svg': modelSvg(), 'monthly-yield.svg': monthlyYieldSvg(report) };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [name, svg] of Object.entries(renderFigures())) {
    writeFileSync(`${here}${name}`, svg);
    console.log(`written docs/images/${name}`);
  }
}
