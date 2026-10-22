// A fake engine for the runner's tests, in plain Node: one behaviour per
// first argument.
//
//   echo       answers the request it was sent, and describes itself
//   error      refuses by name, exit code 1
//   crash      writes to stderr and exits 3 without an answer
//   slow       never answers
//   contract   answers with contract 99
//   pv_yield   answers a pv_yield request with one constant hour per weather
//              hour, as an engine computing a yield would
//   greedy     answers an energy_sharing request giving every participant all
//              of its offtake as shared, whatever was injected: an answer
//              no grid could deliver

const mode = process.argv[2];
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const answer = (result, log = []) => process.stdout.write(JSON.stringify({ engine: envelope.engine, version: 'fake 1.0.0', contract: 1, result, log }));
  const request = envelope.request;

  if (request.describe) {
    answer({ dependencies: { node: process.versions.node }, kinds: mode === 'greedy' ? ['energy_sharing'] : ['echo', 'pv_yield'] });
    return;
  }
  switch (mode) {
    case 'echo':
      process.stderr.write('echoing\n');
      answer({ echoed: request }, ['one line']);
      return;
    case 'error':
      process.stdout.write(JSON.stringify({ error: 'weather_incomplete', detail: 'no temperature' }));
      process.exit(1);
      return;
    case 'crash':
      process.stderr.write('Traceback (most recent call last):\nKeyError: oops\n');
      process.exit(3);
      return;
    case 'slow':
      setTimeout(() => answer({}), 60_000);
      return;
    case 'contract':
      process.stdout.write(JSON.stringify({ engine: envelope.engine, version: 'fake 1.0.0', contract: 99, result: {} }));
      return;
    case 'pv_yield': {
      const poa = request.weather.find((s) => s.quantity_code === 'poa_irradiance' || s.quantity_code === 'ghi');
      const at = poa.values.map((v) => v.at);
      const series = (quantity_code, unit, value, extra = {}) => ({ quantity_code, value_kind: 'interval', step: '1 hour', unit, values: at.map((a) => ({ at: a, value })), ...extra });
      answer({
        series: [
          series('production_energy', 'kWh', 0.5),
          ...request.arrays.map((a) => series('poa_irradiance', 'W/m2', 500, { array: a.name })),
          ...request.arrays.map((a) => series('module_temperature', 'degC', 30, { array: a.name })),
        ],
        meta: { models: request.models, arrays: request.arrays.length },
      });
      return;
    }
    case 'greedy': {
      const participants = request.participants.map((p) => {
        const off = p.series.find((x) => x.quantity_code === 'offtake_energy');
        const zero = off.values.map((v) => ({ at: v.at, value: 0 }));
        const series = (quantity_code, values) => ({ quantity_code, value_kind: 'interval', step: request.step, unit: 'kWh', values });
        return { id: p.id, totals: {}, series: [series('shared_offtake_energy', off.values), series('shared_injection_energy', zero),
          series('offtake_energy', zero), series('injection_energy', p.series.find((x) => x.quantity_code === 'injection_energy').values)] };
      });
      answer({ participants, totals: { shared_energy: 0 }, meta: {} });
      return;
    }
    default:
      process.stdout.write(JSON.stringify({ error: 'kind_unknown', detail: `fake engine mode ${mode}` }));
      process.exit(1);
  }
});
