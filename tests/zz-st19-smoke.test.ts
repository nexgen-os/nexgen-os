import { it, expect } from 'vitest';
import { freshDatabase } from './helpers/db.js';
it('installs', async () => {
  const mods = (process.env.ST19_MODULES ?? '').split(',').filter(Boolean);
  const packs = (process.env.ST19_PACKS ?? '').split(',').filter(Boolean);
  const db = await freshDatabase(mods, packs);
  expect(1).toBe(1);
  await db.close();
}, 120000);
