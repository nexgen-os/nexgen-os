// What each person may see and do, what the core refuses, and what it
// publishes.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asUser, freshDatabase, insert, one, organisation, repoRoot, participant } from './helpers/db.js';

const VIEWER = '00000000-0000-4000-8000-0000000000c1';

let db: PGlite;
let orgA: string;
let orgB: string;
let homeA: string;

beforeAll(async () => {
  db = await freshDatabase(['building']);
  orgA = await organisation(db, 'Firm A', USER_A);
  orgB = await organisation(db, 'Firm B', USER_B);
  await db.query('insert into auth.users (id) values ($1)', [VIEWER]);
  await db.query(`insert into organisation_members (organisation_id, user_id, role) values ($1, $2, 'viewer')`, [orgA, VIEWER]);
  homeA = await participant(db, { organisation_id: orgA, name: 'Hall A', country: 'FR' });
  await participant(db, { organisation_id: orgB, name: 'Hall B', country: 'DE' });
  await db.query(
    `insert into modules (code, name, version, schema_name, requires_core_min) values ('pv', 'PV production', '0.1.0', 'pv', '0.1.0')`,
  );
});

afterAll(async () => {
  await db.close();
});

describe('row level security', () => {
  it('shows each member the participants of their organisation only', async () => {
    const a = await asUser(db, USER_A, () => db.query<{ name: string }>('select name from participants'));
    const b = await asUser(db, USER_B, () => db.query<{ name: string }>('select name from participants'));
    expect(a.rows.map((r) => r.name)).toEqual(['Hall A']);
    expect(b.rows.map((r) => r.name)).toEqual(['Hall B']);
  });

  it('refuses a write in another organisation', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.query(`insert into projects (organisation_id, name, country) values ($1, 'Intruder', 'FR')`, [orgA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses a building of a participant of another organisation', async () => {
    await expect(
      insert(db, 'building.buildings', { organisation_id: orgB, participant_id: homeA, name: 'Cross-border' }),
    ).rejects.toThrow(/parent_in_other_organisation/);
  });

  it('lets a viewer read and nothing else', async () => {
    const r = await asUser(db, VIEWER, () => db.query('select id from participants'));
    expect(r.rows).toHaveLength(1);
    await expect(
      asUser(db, VIEWER, () =>
        db.query(`insert into attributes (object_kind, object_id, attribute_type, value) values ('participant', $1, 'annual_consumption', '12000')`, [homeA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('lets a member create an organisation and become its owner', async () => {
    const r = await asUser(db, USER_B, async () => {
      await db.query(`insert into organisations (name) values ('Firm B — second office')`);
      return db.query<{ name: string }>('select name from organisations order by name');
    });
    expect(r.rows.map((x) => x.name)).toEqual(['Firm B', 'Firm B — second office']);
  });

  it('lets everyone signed in read the vocabularies and the shared catalogue', async () => {
    await db.query(
      `insert into products (device_type, manufacturer, model_ref, unit_power_kw, published_by) values ('solar', 'Acme', 'Sun 425', 0.425, 'energy')`,
    );
    const r = await asUser(db, USER_B, () =>
      one<{ types: number; products: number }>(db, 'select (select count(*)::int from device_types) types, (select count(*)::int from products) products'),
    );
    expect(r.types).toBeGreaterThan(10);
    expect(r.products).toBe(1);
  });
});

describe("a module's figures", () => {
  // A module that computes keeps its figures in a plain table of its own, of
  // the shape supabase/migrations/…_core_modules.sql describes.
  beforeAll(async () => {
    await db.exec(`
      create schema pv;
      grant usage on schema pv to authenticated, service_role;
      create table pv.estimates (
        id               uuid primary key default gen_random_uuid(),
        organisation_id  uuid not null references nexgen.organisations(id) on delete cascade,
        participant_id   uuid not null references nexgen.participants(id) on delete cascade,
        provenance       text not null,
        inputs           jsonb not null,
        results          jsonb not null,
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now());
      create trigger estimates_set_updated_at before update on pv.estimates for each row execute function nexgen.set_updated_at();
      call nexgen.secure_table('pv.estimates');
    `);
  });

  it('are read and written by the members of their organisation only', async () => {
    const estimate = await asUser(db, USER_A, () =>
      one<{ id: string }>(db, `insert into pv.estimates (organisation_id, participant_id, provenance, inputs, results)
                               values ($1, $2, 'pv 0.1.0', '{"horizon": "2027"}', '{"kwh": 5400}') returning id`, [orgA, homeA]),
    );
    expect((await asUser(db, USER_B, () => db.query('select id from pv.estimates'))).rows).toEqual([]);
    expect((await asUser(db, VIEWER, () => db.query('select id from pv.estimates'))).rows).toEqual([{ id: estimate.id }]);
    expect((await asUser(db, VIEWER, () => db.query(`update pv.estimates set results = '{"kwh": 1}' returning id`))).rows).toEqual([]);
    await expect(asUser(db, USER_B, () => db.query(`insert into pv.estimates (organisation_id, participant_id, provenance, inputs, results)
                                                     values ($1, $2, 'pv 0.1.0', '{}', '{}')`, [orgA, homeA])))
      .rejects.toThrow(/row-level security/);
  });

  it('are replaced by a new computation, which dates the change', async () => {
    const before = await one<{ id: string; created_at: Date; updated_at: Date }>(db, 'select id, created_at, updated_at from pv.estimates');
    await asUser(db, USER_A, () => db.query(`update pv.estimates set provenance = 'pv 0.2.0', results = '{"kwh": 5410}' where id = $1`, [before.id]));
    const after = await one<{ provenance: string; results: { kwh: number }; created_at: Date; updated_at: Date }>(
      db, 'select provenance, results, created_at, updated_at from pv.estimates where id = $1', [before.id]);
    expect(after).toMatchObject({ provenance: 'pv 0.2.0', results: { kwh: 5410 }, created_at: before.created_at });
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  });
});

describe('organisations', () => {
  it('never lose their last owner', async () => {
    await expect(asUser(db, USER_A, () => db.query(`select remove_member($1, $2)`, [orgA, USER_A]))).rejects.toThrow(/last_owner/);
    await expect(asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'editor')`, [orgA, USER_A]))).rejects.toThrow(/last_owner/);
    await asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'editor')`, [orgA, VIEWER]));
    await asUser(db, USER_A, () => db.query(`select set_member_role($1, $2, 'viewer')`, [orgA, VIEWER]));
  });

  it('are objects: an attribute attaches to one, readable by its members only', async () => {
    await expect(db.query(`insert into attributes (object_kind, object_id, attribute_type, value, source) values ('organisation', $1, 'subscribed_power', '120', 'a guess')`, [orgA]))
      .rejects.toThrow(/attribute_type_not_applicable/);
    await db.query(`insert into attribute_types (code, name, datatype, published_by) values ('discount_rate', 'Discount rate', 'number', 'installation')`);
    await asUser(db, USER_A, () => db.query(`select set_attribute('organisation', $1, 'discount_rate', '0.04', null, null, 'board decision')`, [orgA]));
    const mine = await asUser(db, USER_A, () => db.query(`select value from attributes where object_id = $1`, [orgA]));
    const theirs = await asUser(db, USER_B, () => db.query(`select value from attributes where object_id = $1`, [orgA]));
    expect(mine.rows).toEqual([{ value: 0.04 }]);
    expect(theirs.rows).toEqual([]);
  });

  it('read the pack\'s defaults and write none of them: their own are their attributes', async () => {
    await db.query(`insert into countries (code, name, currency, time_zones, region_level, pack_version, published_by) values ('ZZ', 'Testland', 'ZZZ', '{UTC}', 'region', '0.1.0', 'pack:zz')`);
    await db.query(`insert into sources (code, name, kind) values ('zz_statistics', 'Testland statistics', 'text')`);
    await db.query(`insert into defaults (attribute_type, country, value, source_code, reference, published_by) values ('discount_rate', 'ZZ', '0.05', 'zz_statistics', 'table 1', 'pack:zz')`);
    const a = await asUser(db, USER_A, () => db.query<{ value: number }>(`select value from defaults`));
    const b = await asUser(db, USER_B, () => db.query<{ value: number }>(`select value from defaults`));
    expect(a.rows.map((r) => r.value)).toEqual([0.05]);
    expect(b.rows.map((r) => r.value)).toEqual([0.05]);
    await expect(asUser(db, USER_A, () => db.query(`insert into defaults (attribute_type, country, value, source_code, valid_from, published_by) values ('discount_rate', 'ZZ', '0.03', 'zz_statistics', '2030-01-01', 'firm a')`)))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, USER_B, () => db.query(`update defaults set reference = 'edited' where country = 'ZZ'`))).rejects.toThrow(/permission denied/);
  });
});

describe('what the core publishes', () => {
  it('names no module that does not ship in a device type', async () => {
    const shipped = (await readdir(join(repoRoot, 'modules'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    const r = await db.query<{ code: string; module_code: string }>(`select code, module_code from device_types where module_code is not null`);
    expect(r.rows.filter((t) => !shipped.includes(t.module_code))).toEqual([]);
  });

  it('has row level security on every table of the schema', async () => {
    const r = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'nexgen' and c.relkind in ('r', 'p') and not c.relrowsecurity and not c.relispartition`,
    );
    expect(r.rows).toEqual([]);
  });

  it('names no country in what the core publishes', async () => {
    const r = await db.query(
      `select code from identifier_schemes where code ~ '_(be|fr|nl|es|de|lu|sn)$'
       union all select code from device_types where code ~ '_(be|fr|nl|es|de|lu|sn)$'
       union all select code from building.uses where code ~ '_(be|fr|nl|es|de|lu|sn)$'`,
    );
    expect(r.rows).toEqual([]);
  });

  it('attaches by kind and id: an attachment names its object, and goes with it', async () => {
    const r = await db.query(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                               where n.nspname = 'nexgen' and c.relname in ('objects', 'object_kinds', 'object_parent_tables')`);
    expect(r.rows).toEqual([]);
    const shed = await participant(db, { organisation_id: orgA, name: 'Shed', country: 'BE' });
    await db.query(`select set_attribute('participant', $1, 'annual_consumption', '800')`, [shed]);
    await db.query(`select add_identifier('participant', $1, 'osm', 'way/1')`, [shed]);
    await db.query('delete from participants where id = $1', [shed]);
    const left = await one<{ n: number }>(db, `select (select count(*) from attributes where object_id = $1) + (select count(*) from identifiers where object_id = $1) n`, [shed]);
    expect(Number(left.n)).toBe(0);
  });

  it('refuses by name an attachment to an object that is not found, of a kind that is not one of the six, or of another organisation', async () => {
    await expect(db.query(`select set_attribute('participant', gen_random_uuid(), 'annual_consumption', '1')`)).rejects.toThrow(/object_not_found/);
    await expect(db.query(`select set_attribute('spaceship', $1, 'annual_consumption', '1')`, [homeA])).rejects.toThrow(/kind_unknown/);
    await expect(asUser(db, USER_B, () => db.query(`select set_attribute('participant', $1, 'annual_consumption', '1')`, [homeA])))
      .rejects.toThrow(/object_not_found/);
  });
});
