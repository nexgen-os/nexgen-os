// Weather answers for tests: recorded fixtures, and an Open-Meteo archive
// that makes up a sky for any period.
import { readFile } from 'node:fs/promises';
import type { Fetch } from '../../formats/geocoding/index.js';
import { repoRoot } from './db.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const fixture = async (name: string) => JSON.parse(await readFile(`${repoRoot}/tests/fixtures/${name}`, 'utf8'));

export const answering = (body: unknown, asked: string[] = []): Fetch => async (url) => {
  asked.push(url);
  return { ok: true, status: 200, json: async () => body };
};

/**
 * An Open-Meteo archive that makes up its answer for the days asked: a sky
 * whose clear-sky irradiance is dimmed by a cloudiness of each day, at 15 °C
 * and 2 m/s, dated as Open-Meteo dates it (the mean of the hour before the
 * stamp). The south plane gets more than the east one; the horizontal
 * components follow the same sky. After `missingFrom`, every value is null,
 * as for hours the archive does not have yet.
 */
export const syntheticArchive = (lon: number, asked: string[], missingFrom?: string): Fetch => async (url) => {
  asked.push(url);
  const q = new URL(url).searchParams;
  const start = Date.parse(`${q.get('start_date')}T00:00:00Z`);
  const end = Date.parse(`${q.get('end_date')}T00:00:00Z`) + DAY;
  const plane = q.get('azimuth') === '0' ? 1 : 0.8;
  const shares: Record<string, number> = { global_tilted_irradiance: plane, shortwave_radiation: 0.9, direct_normal_irradiance: 0.9, diffuse_radiation: 0.3 };
  const asks = (q.get('hourly') ?? '').split(',');
  const hourly: Record<string, (number | null)[]> = { time: [], temperature_2m: [], wind_speed_10m: [] };
  for (const v of asks) if (v in shares) hourly[v] = [];
  for (let at = start; at < end; at += HOUR) {
    const middle = at - HOUR / 2 + (lon / 15) * HOUR;
    const solarHour = (((middle / HOUR) % 24) + 24) % 24;
    const cloudiness = 0.3 + (0.7 * ((Math.floor(middle / DAY) * 7919) % 13)) / 12;
    const missing = missingFrom !== undefined && at > Date.parse(missingFrom);
    const sky = Math.max(0, Math.sin((Math.PI * (solarHour - 6)) / 12)) * 800 * cloudiness;
    hourly.time.push(at / 1000);
    for (const v of Object.keys(shares)) hourly[v]?.push(missing ? null : Math.round(sky * shares[v] * 10) / 10);
    hourly.temperature_2m.push(missing ? null : 15);
    hourly.wind_speed_10m.push(missing ? null : 2);
  }
  return { ok: true, status: 200, json: async () => ({ hourly }) };
};
