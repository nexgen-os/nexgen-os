// A PV yield as a run that says what it was computed from (decision 0012).
//
// The `pvgis_like` profile is the cheapest one to verify: PVGIS itself does
// the computation (its irradiance, its DEM horizon, its one aggregate loss),
// and the run records the system, the arrays, the years, the radiation
// database PVGIS chose and the conventions the series are written in. The
// hourly energy lands as a `simulated` series on the PV system; the run
// keeps the summary. Engines run outside Postgres; the database holds the
// parameters, the series and the run.

import type { Db } from '../../formats/db.js';
import { storeSeries, type CollectedSeries } from '../../connectors/index.js';
import { pvgis, type PvgisSystem } from '../../connectors/pvgis/index.js';

export const ENGINE_VERSION = 'pvgis-5.3+solar-0.1.0';

export interface YieldRequest {
  pvSystemId: string;
  years: { from: number; to: number };
  /** Default `pvgis_like`; only that profile runs through PVGIS. */
  profileCode?: string;
  /** PVGIS radiation database to force (`PVGIS-SARAH3`, `PVGIS-ERA5`); default: PVGIS's choice for the place. */
  raddatabase?: string;
}

export interface YieldResult {
  runId: string;
  seriesId: string;
  annualKwh: number;
  kwhPerKwp: number;
  kwp: number;
  radiationDb: string;
}

interface SystemRow {
  organisation_id: string;
  site_id: string;
  kwp_dc: string | null;
  lon: number | null;
  lat: number | null;
  device_azimuth: string | null;
  device_tilt: string | null;
}

interface ArrayRow {
  name: string;
  azimuth_deg: string | null;
  tilt_deg: string | null;
  mounting: string;
  kwp_dc: string | null;
}

/** PVGIS knows two mountings: on a building, or free-standing. */
const PVGIS_MOUNTING: Record<string, PvgisSystem['mounting']> = {
  open_rack: 'free',
  tracker: 'free',
  floating: 'free',
  roof_parallel: 'building',
  semi_integrated: 'building',
  insulated: 'building',
};

export async function runYield(db: Db, request: YieldRequest, client = pvgis()): Promise<YieldResult> {
  const profileCode = request.profileCode ?? 'pvgis_like';
  if (profileCode !== 'pvgis_like') throw new Error(`profile_not_runnable_here: ${profileCode} needs an engine; only pvgis_like runs through PVGIS`);

  const system = (
    await db.query<SystemRow>(
      `select d.organisation_id, d.site_id, p.kwp_dc,
              ST_X(ST_Centroid(s.geometry)) lon, ST_Y(ST_Centroid(s.geometry)) lat,
              f.azimuth_deg device_azimuth, f.tilt_deg device_tilt
         from solar.pv_systems p
         join devices d on d.id = p.id
         join sites s on s.id = d.site_id
         left join surfaces f on f.id = d.surface_id
        where p.id = $1`,
      [request.pvSystemId],
    )
  ).rows[0];
  if (!system) throw new Error(`pv_system_not_found: ${request.pvSystemId}`);
  if (system.lon === null || system.lat === null) throw new Error('site_without_position: the site of the PV system has no geometry');

  const profile = (await db.query<{ losses: { code: string; pct: number }[] }>('select losses from solar.yield_profiles where code = $1', [profileCode])).rows[0];
  if (!profile) throw new Error(`yield_profile_unknown: ${profileCode}`);
  const systemLoss = profile.losses.reduce((sum, l) => sum + Number(l.pct), 0);

  let arrays = (await db.query<ArrayRow>('select name, azimuth_deg, tilt_deg, mounting, kwp_dc from solar.pv_arrays where pv_system_id = $1 order by created_at, id', [request.pvSystemId])).rows;
  if (arrays.length === 0) {
    // A system described without arrays: one array on the device's own surface, with the system's power.
    arrays = [{ name: 'whole system', azimuth_deg: system.device_azimuth, tilt_deg: system.device_tilt, mounting: 'roof_parallel', kwp_dc: system.kwp_dc }];
  }
  for (const a of arrays) {
    if (a.azimuth_deg === null || a.tilt_deg === null) throw new Error(`array_without_orientation: ${a.name}`);
    if (a.kwp_dc === null || Number(a.kwp_dc) <= 0) throw new Error(`array_without_power: ${a.name}`);
  }

  const where = { lon: system.lon, lat: system.lat };
  const perArray = [];
  for (const a of arrays) {
    const spec: PvgisSystem = { kwp: Number(a.kwp_dc), azimuth_deg: Number(a.azimuth_deg), tilt_deg: Number(a.tilt_deg), mounting: PVGIS_MOUNTING[a.mounting] ?? 'building', system_loss_pct: systemLoss };
    perArray.push({ spec, answer: await client.hourly(where, spec, request.years, { raddatabase: request.raddatabase }) });
  }

  // Energies add up across arrays, hour by hour; the temperature is the site's, taken once.
  const energy = sumSeries(perArray.map((x) => x.answer.series.find((s) => s.quantity_code === 'production_energy')!));
  const temperature = perArray[0].answer.series.find((s) => s.quantity_code === 'temperature')!;
  const target = { organisationId: system.organisation_id, objectId: request.pvSystemId, sourceCode: client.source_code, kind: 'simulated' as const };
  const stored = await storeSeries(db, target, energy);
  await storeSeries(db, { ...target, objectId: system.site_id }, temperature);

  const kwp = perArray.reduce((s, x) => s + x.spec.kwp, 0);
  const nYears = request.years.to - request.years.from + 1;
  const annualKwh = round(energy.values.reduce((s, v) => s + v.value, 0) / nYears);
  const radiationDb = perArray[0].answer.meta.radiation_db;
  const run = await db.query<{ id: string }>(
    `select record_run('solar', $1, $2, null, $3::jsonb, $4::jsonb) id`,
    [
      ENGINE_VERSION,
      request.pvSystemId,
      JSON.stringify({
        profile: profileCode,
        weather: { source: client.source_code, radiation_db: radiationDb, meteo_db: perArray[0].answer.meta.meteo_db, years: request.years, horizon: perArray[0].answer.meta.horizon },
        arrays: perArray.map((x) => ({ kwp: x.spec.kwp, azimuth_deg: x.spec.azimuth_deg, tilt_deg: x.spec.tilt_deg, mounting: x.spec.mounting })),
        losses: profile.losses,
        conventions: { azimuth: 'degrees clockwise from true north', time: 'interval start, UTC', energy: 'kWh per hour' },
      }),
      JSON.stringify({ series_id: stored.seriesId, annual_kwh: annualKwh, kwh_per_kwp: round(annualKwh / kwp), kwp }),
    ],
  );
  return { runId: run.rows[0].id, seriesId: stored.seriesId, annualKwh, kwhPerKwp: round(annualKwh / kwp), kwp, radiationDb };
}

function sumSeries(series: CollectedSeries[]): CollectedSeries {
  const byAt = new Map<string, number>();
  for (const s of series) for (const v of s.values) byAt.set(v.at, (byAt.get(v.at) ?? 0) + v.value);
  return { ...series[0], values: [...byAt.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([at, value]) => ({ at, value: round(value) })) };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
