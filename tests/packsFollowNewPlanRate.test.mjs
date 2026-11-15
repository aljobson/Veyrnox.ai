import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const web = readFileSync('packages/db/schema/supabase/0540_packs_follow_new_plan_rate.sql', 'utf8');
const store = readFileSync('packages/db/schema/supabase/0541_store_packs_follow_new_plan_rate.sql', 'utf8');
const plans = [
  { id: 'lite-monthly', credits: 185, price: 1000 },
  { id: 'starter-monthly', credits: 354, price: 1900 },
  { id: 'plus-monthly', credits: 1102, price: 5900 },
  { id: 'ultra-monthly', credits: 2411, price: 12900 },
];
const webPacks = [{ id: 'web-186', credits: 186, price: 999 }, { id: 'web-467', credits: 467, price: 2499 }, { id: 'web-1401', credits: 1401, price: 7499 }];
const storePacks = [{ credits: 186, price: 999 }, { credits: 467, price: 2499 }, { credits: 1401, price: 7499 }];

test('web packs are the best plan rate rounded down and never cheaper than it', () => {
  const best = Math.max(...plans.map((p) => p.credits / p.price));
  for (const p of webPacks) {
    assert.equal(Math.floor(p.price * best), p.credits, p.id);
    assert.ok(plans.some((s) => p.price * s.credits >= p.credits * s.price && p.price * s.credits * 100 <= p.credits * s.price * 101), `${p.id} parity`);
  }
});

test('web packs keep 50 percent and every floor', () => {
  for (const p of webPacks) {
    assert.ok(p.price * 420 - 30000 >= p.credits * 1796, `${p.id} margin`);
    assert.ok(p.price * 10 >= p.credits * 43, `${p.id} sticker floor`);
    assert.ok(p.price * 91745 - 5000000 >= p.credits * 330000, `${p.id} net floor`);
  }
});

test('web and store packs sell at exactly the same price', () => {
  assert.deepEqual(webPacks.map((p) => [p.credits, p.price]), storePacks.map((p) => [p.credits, p.price]));
});

test('store packs keep 50 percent at a 15 percent fee and clear the 30 percent net floor', () => {
  for (const p of storePacks) {
    assert.ok(p.price * 350 >= p.credits * 1796, `${p.credits} margin`);
    assert.ok(p.price * 70000 >= p.credits * 330000, `${p.credits} net floor`);
  }
});

test('0540 refuses to run before 0539 and retires the old web packs by shape', () => {
  assert.match(web, /lite-monthly:185,plus-monthly:1102,starter-monthly:354,ultra-monthly:2411/);
  for (const shape of ["id = 'web-209' AND credits = 209 AND price_usd_cents = 1000", "id = 'web-523' AND credits = 523 AND price_usd_cents = 2500", "id = 'web-1571' AND credits = 1571 AND price_usd_cents = 7500"]) assert.ok(web.includes(shape), shape);
  assert.match(web, /web-186:186:999,web-467:467:2499,web-1401:1401:7499/);
  assert.match(web, /not at the monthly subscription rate/);
  assert.doesNotMatch(web, /DELETE\s+FROM\s+public\.credit_packs/i);
});

test('0541 adds the new store products, retires the old six by shape and checks alignment', () => {
  for (const id of ['186', '467', '1401']) assert.match(store, new RegExp(`ai\\.veyrnox\\.credits\\.${id}`));
  for (const shape of ["'ai.veyrnox.credits.209' AND credits = 209 AND price_usd_cents = 1099", "'ai.veyrnox.credits.523' AND credits = 523 AND price_usd_cents = 2699", "'ai.veyrnox.credits.1571' AND credits = 1571 AND price_usd_cents = 8999"]) assert.ok(store.includes(shape), shape);
  assert.match(store, /price_usd_cents::bigint \* 350 < credits::bigint \* 1796/);
  assert.match(store, /differ between web, iOS and Android/);
  assert.doesNotMatch(store, /DELETE\s+FROM\s+public\.credit_packs/i);
});
