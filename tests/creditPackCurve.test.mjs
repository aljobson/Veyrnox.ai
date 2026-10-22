import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ADR-0037 amendment 1 (migration 0365). A pack may give a credit no cheaper
// than the margin target allows: after an 8% + $0.30 fee, a credit that
// carries the catalog's worst-case provider cost ($0.01796) must still leave
// half of the pack's price. The database floors (0041, 0121) are checked as
// well, so a pack that passes here also passes the constraints.
const migration = readFileSync(new URL('../packages/db/schema/supabase/0365_flatten_credit_pack_curve.sql', import.meta.url), 'utf8');

const WORST_COST_PER_CREDIT = 0.01796;
const FEE_PERCENT = 0.08;
const FEE_FIXED = 0.30;

function packsInserted() {
  const block = migration.slice(migration.indexOf('INSERT INTO public.credit_packs'), migration.indexOf('ON CONFLICT (id) DO NOTHING'));
  return [...block.matchAll(/\('(web-\d+)', 'web', (\d+), (\d+), true\)/g)]
    .map(([, id, credits, cents]) => ({ id, credits: Number(credits), cents: Number(cents) }));
}
const TOP = { id: 'web-3000', credits: 3000, cents: 12900 };

function worstCaseMargin({ credits, cents }) {
  const price = cents / 100;
  return (price - (price * FEE_PERCENT + FEE_FIXED) - credits * WORST_COST_PER_CREDIT) / price;
}

test('the migration adds the three recommended packs and leaves the top pack alone', () => {
  assert.deepEqual(packsInserted(), [
    { id: 'web-160', credits: 160, cents: 1000 },
    { id: 'web-330', credits: 330, cents: 1900 },
    { id: 'web-1300', credits: 1300, cents: 5900 },
  ]);
  assert.match(migration, /web-3000[^\n]*3000[^\n]*12900/);
});

test('every active pack keeps the 50 percent target for the worst-costed credit', () => {
  for (const pack of [...packsInserted(), TOP]) {
    assert.ok(worstCaseMargin(pack) >= 0.5 - 1e-9, `${pack.id} margin ${worstCaseMargin(pack)}`);
    // The migration's integer guard is the same inequality.
    assert.ok(pack.cents * 420 - 30000 >= pack.credits * 1796, `${pack.id} passes the integer guard`);
    // credit_packs_sticker_floor (0121): at least $0.043 a credit.
    assert.ok(pack.cents * 10 >= pack.credits * 43, `${pack.id} clears the sticker floor`);
    // credit_packs_net_floor (0041): net of the legacy fee formula, at least $0.033 a credit.
    assert.ok(pack.cents * 91745 - 5_000_000 >= pack.credits * 330000, `${pack.id} clears the legacy net floor`);
  }
});

test('a bigger pack is never dearer per credit, and the entry pack is cheaper than before', () => {
  const packs = [...packsInserted(), TOP].sort((a, b) => a.credits - b.credits);
  const rates = packs.map((p) => p.cents / p.credits);
  for (let i = 1; i < rates.length; i++) assert.ok(rates[i] <= rates[i - 1], `${packs[i].id} is not dearer than ${packs[i - 1].id}`);
  assert.ok(rates[0] < 1000 / 100, 'entry pack is cheaper per credit than web-100');
});

test('the migration retires the old packs by exact shape, keeps history, and asserts row counts', () => {
  for (const shape of ["id = 'web-100' AND credits = 100 AND price_usd_cents = 1000", "id = 'web-270' AND credits = 270 AND price_usd_cents = 1900", "id = 'web-1200' AND credits = 1200 AND price_usd_cents = 5900"]) {
    assert.ok(migration.includes(shape), shape);
  }
  assert.equal((migration.match(/GET DIAGNOSTICS affected = ROW_COUNT;/g) || []).length, 2);
  assert.match(migration, /IF affected <> 3 THEN/);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.credit_packs/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.credit_packs\s+SET\s+(credits|price_usd_cents)/i);
  assert.match(migration, /web-160:160:1000,web-330:330:1900,web-1300:1300:5900,web-3000:3000:12900/);
});
