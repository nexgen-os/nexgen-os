// What the rules of the core cost a reader (decision 0059): the functions a
// rule calls, counted in the transaction of one read by a participant's
// account, on an instance of a few participants and on one of many. Today
// a rule is asked once per row of the table, whoever reads: the count grows
// with the instance, not with what the reader sees. The target is written
// below as an expected failure; the rule evaluated by set turns it into a
// plain test.
//
// With NEXGEN_MEASURE_ACCESS=1 the file also prints, for instances of one to
// ten thousand participants, the time and the calls of the reads a customer
// application makes on its home screen — the figures decision 0059 quotes.
import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, insert, one, organisation } from './helpers/db.js';

const OWNER = '00000000-0000-4000-8000-000000000201';
const HOUSEHOLD = '00000000-0000-4000-8000-000000000202';

/** The functions the rules of the core call for a row, whose calls are counted. */
const RULE_FUNCTIONS = ['row_has_capability', 'has_capability', 'project_of', 'participant_of', 'object_organisation'];

/** The reads of a customer's home screen: its participant, its meters, its devices, its series, its attributes. */
const READS: Record<string, string> = {
  participants: 'select id from participants',
  meters: 'select id from meters',
  devices: 'select id from devices',
  series: 'select id from series',
  attributes: 'select id from attributes',
};

let db: PGlite | undefined;

afterEach(async () => {
  await db?.close();
  db = undefined;
});

/**
 * An instance of `count` participants in one project, each with a meter, a
 * device, two series and an attribute, written in bulk as an import would;
 * the first participant is the household's account.
 */
async function instance(count: number): Promise<PGlite> {
  const d = await freshDatabase();
  const org = await organisation(d, 'A supplier', OWNER);
  await d.query('insert into auth.users (id) values ($1) on conflict do nothing', [HOUSEHOLD]);
  const project = await insert(d, 'projects', { organisation_id: org, name: 'Customers', country: 'BE' });
  const type = (await one<{ code: string }>(d, 'select code from device_types order by code limit 1')).code;
  await d.query(`
    insert into participants (organisation_id, project_id, name, country)
    select $1, $2, 'Customer ' || g, 'BE' from generate_series(1, $3::int) g`, [org, project, count]);
  await d.query(`
    insert into meters (organisation_id, participant_id, project_id, identifier, scheme)
    select organisation_id, id, project_id, '54' || lpad(substr(name, 10), 16, '0'), 'gs1_gsrn' from participants`);
  await d.query(`
    insert into devices (organisation_id, participant_id, name, device_type)
    select organisation_id, id, 'Device of ' || name, $1 from participants`, [type]);
  await d.query(`
    insert into series (organisation_id, object_kind, object_id, quantity_code, step)
    select organisation_id, 'meter', id, q, interval '15 minutes' from meters, unnest(array['offtake_energy', 'injection_energy']) q`);
  await d.query(`
    insert into attributes (organisation_id, object_kind, object_id, attribute_type, value, source)
    select organisation_id, 'participant', id, 'annual_consumption', '3500'::jsonb, 'bills' from participants`);
  await d.query(`update participants set user_id = $1 where name = 'Customer 1'`, [HOUSEHOLD]);
  await d.exec('analyze');
  return d;
}

/** The calls of the rule's functions counted so far in the transaction. */
const callsSoFar = async (d: PGlite) => (await one<{ calls: number }>(d, `
  select coalesce(sum(pg_stat_get_xact_function_calls(p.oid)), 0)::int calls
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'nexgen' and p.proname = any($1)`, [RULE_FUNCTIONS])).calls;

/** One read by the household's account: the rows it sees, the calls of the rule's functions it made and the time it took. */
async function read(d: PGlite, sql: string): Promise<{ rows: number; calls: number; ms: number }> {
  await d.exec('begin');
  try {
    await d.exec(`set local track_functions = 'pl'`);
    const before = await callsSoFar(d);
    await d.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: HOUSEHOLD, role: 'authenticated' })]);
    await d.exec('set local role authenticated');
    const started = performance.now();
    const rows = (await d.query(sql)).rows.length;
    const ms = performance.now() - started;
    await d.exec('reset role');
    return { rows, calls: (await callsSoFar(d)) - before, ms };
  } finally {
    await d.exec('rollback');
  }
}

describe('what a rule costs a reader', () => {
  it('shows the account of a participant its own rows only, on a small instance and on a larger one', async () => {
    for (const count of [20, 200]) {
      db = await instance(count);
      expect((await read(db, READS.series)).rows).toBe(2);
      expect((await read(db, READS.meters)).rows).toBe(1);
      await db.close();
      db = undefined;
    }
  });

  it('asks the rule once per row of the table today, whoever reads', async () => {
    db = await instance(50);
    // Every one of the 100 series is checked, and the rows the reader does
    // not see are checked twice: by the reading rule and by the writing one,
    // which covers reads too (`for all`).
    expect((await read(db, READS.series)).calls).toBeGreaterThanOrEqual(100);
  });

  it.fails('asks the rule a number of times that does not grow with the instance (the target of decision 0059)', async () => {
    db = await instance(20);
    const small = await read(db, READS.series);
    await db.close();
    db = await instance(200);
    const large = await read(db, READS.series);
    expect(large.calls).toBe(small.calls);
  });
});

describe.runIf(process.env.NEXGEN_MEASURE_ACCESS === '1')('the reads of a home screen, measured', () => {
  it('prints their time and their calls for instances of one to ten thousand participants', async () => {
    const lines = ['| participants | read | rows seen | calls of the rule | ms |', '|---:|---|---:|---:|---:|'];
    for (const count of [1_000, 3_000, 10_000]) {
      db = await instance(count);
      for (const [name, sql] of Object.entries(READS)) {
        await read(db, sql);
        const r = await read(db, sql);
        lines.push(`| ${count} | ${name} | ${r.rows} | ${r.calls} | ${r.ms.toFixed(0)} |`);
      }
      await db.close();
      db = undefined;
    }
    console.log(lines.join('\n'));
  }, 900_000);
});
