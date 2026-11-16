// A PV*SOL study read into a plain project: its arrays as PV*SOL oriented
// them, its inverters, its load profile at its own step, its losses and the
// results of its simulation in kWh and °C; what is missing or disagrees
// named, never corrected.
import { describe, expect, it } from 'vitest';
import { isPvsolFileName, readPvsolStudy } from '@nexgen-os/pvsol';
import { study, zip } from './study.js';

describe('reading a PV*SOL study', () => {
  it('reads the project, its arrays with their azimuth clockwise from north, and its inverters', () => {
    const read = readPvsolStudy(study());
    expect([read.program, read.schema_version, read.tested]).toEqual(['PV*SOL premium 2026 (R1)', 23, true]);
    expect(read.project).toEqual({
      title: 'Warehouse roof', author: 'A. Designer', commissioning_date: '2026-04-16',
      site_address: '1 Example Street, 1000 Sample Town', customer_company: 'Example Logistics', customer_contact: 'B. Owner',
    });
    expect(read.arrays.map((a) => [a.id, a.tilt_deg, a.azimuth_deg, a.module_count, a.power_kwp])).toEqual([
      ['area-ne', 15, 52, 135, 60.75],
      ['area-sw', 15, 231.5, 162, 72.9],
    ]);
    expect(read.arrays[0]!.module).toEqual({ manufacturer: 'Example Solar', model: 'EX-450M', power_w: 450 });
    expect(read.declared_power_kwp).toBe(133.65);
    expect(read.inverters).toEqual([{ manufacturer: 'Example Power', model: 'EP 60', count: 2 }]);
    expect(read.weather_file).toBe('Sample Town.wbv');
    expect(read.problems).toEqual([{ code: 'array_empty', level: 'warning', message: 'the array Canopy has no module and is left aside' }]);
  });

  it('keeps the load profile at its step, in watts, from the gzip stream .NET pads with zeros', () => {
    const profile = readPvsolStudy(study()).load_profile!;
    expect([profile.name, profile.step_minutes, profile.values_w.length, profile.declared_total_kwh]).toEqual(['Site load 2025', 15, 35040, 8761]);
    expect(profile.values_w.slice(0, 6)).toEqual([2000, 2000, 2000, 2000, 1000, 1000]);
  });

  it('reads the losses and the results of the simulation in kWh and °C, the system balance being the largest', () => {
    const read = readPvsolStudy(study());
    expect(read.losses).toEqual({ spectral: 0.01, ac_cabling: 0.03, mismatch: 0.02, diodes: 0.005, soiling: 0, albedo: 0.2, bifacial: false });
    const results = read.results!;
    expect([results.production_kwh, results.inverter_input_kwh, results.consumption_kwh, results.self_consumed_kwh, results.offtake_kwh, results.injection_kwh])
      .toEqual([125000, 130000, 8761, 5000, 3761, 120000]);
    expect([results.self_consumption_rate, results.self_sufficiency_rate]).toEqual([0.04, 0.5707]);
    expect(results.ghi_monthly_kwh_m2).toEqual(Array(12).fill(100));
    expect(results.temperature_monthly_c).toEqual(Array(12).fill(11));
    expect(read.arrays.map((a) => a.results)).toEqual([
      { energy_kwh: 56000, specific_yield_kwh_per_kwp: 922, performance_ratio: 0.91, poa_monthly_kwh_m2: Array(12).fill(90) },
      { energy_kwh: 69000, specific_yield_kwh_per_kwp: 1081, performance_ratio: 0.92, poa_monthly_kwh_m2: Array(12).fill(100) },
    ]);
  });

  it('names what the study lacks or what disagrees inside it, and reads the rest', () => {
    const read = readPvsolStudy(study({ without: ['SimResults.xml', 'DB.json'], program: 'PV*SOL premium 2019', declaredTotal: 9500 }));
    expect(read.tested).toBe(false);
    expect(read.results).toBeNull();
    expect(read.arrays.map((a) => a.power_kwp)).toEqual([null, null]);
    expect(read.problems.map((p) => p.code)).toEqual(['program_untested', 'module_power_missing', 'module_power_missing', 'array_empty', 'load_profile_total', 'not_simulated']);
    expect(read.problems.find((p) => p.code === 'load_profile_total')!.message).toBe('the load profile adds up to 8761 kWh, it declares 9500 kWh');
  });

  it('refuses what is not a PV*SOL study', () => {
    expect(() => readPvsolStudy(new TextEncoder().encode('Project;Participant\n'))).toThrow(/^pvsol_unreadable: not a ZIP archive/);
    expect(() => readPvsolStudy(zip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]))).toThrow(/^pvsol_unreadable: the archive holds no Project.xml/);
    expect(() => readPvsolStudy(zip([{ name: 'Project.xml', data: '<PVData><PVModule></PVData>' }]))).toThrow(/^pvsol_unreadable: Project.xml holds an unexpected <\/PVData>/);
    expect([isPvsolFileName('Roof.PVPRJ'), isPvsolFileName('roof.xlsx')]).toEqual([true, false]);
  });
});
