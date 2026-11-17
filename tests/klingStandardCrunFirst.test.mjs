import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY } from '../lib/modelCapabilities.js';

const sql = readFileSync('packages/db/schema/supabase/0558_kling_standard_crun_first_active.sql', 'utf8');

test('it records fal as route 1, proves and activates Crun, reorders Crun first, then activates the offer', () => {
  assert.match(sql, /'fal', 'fal-ai\/kling-video\/v3\/standard\/image-to-video', 0\.4200, 'per_second', 5, 1, 'active', 'official'/);
  assert.match(sql, /endpoint = 'crun:kling\/v3-std' AND model_id = 'kling-3\.0-standard-i2v'/);
  assert.match(sql, /state = 'active'/);
  assert.match(sql, /model_route_reorder\(\s*'kling-3\.0-standard-i2v'/);
  assert.ok(sql.indexOf('model_route_reorder') < sql.indexOf('SET active = true'), 'the offer goes live only after Crun is first');
});

test('every UPDATE names the row exactly and asserts one row', () => {
  assert.equal((sql.match(/GET DIAGNOSTICS affected = ROW_COUNT;/g) || []).length, 2);
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /<> 2 THEN/, 'final routes assertion');
});

test('the price is unchanged and both routes sit inside the 24-credit floor', () => {
  const CAP = 0.01796; // ADR-0037
  assert.match(sql, /credits_5s = 24/);
  assert.equal(Math.ceil(0.3398 / CAP), 19);
  assert.ok(0.4200 <= 24 * CAP, 'fal, second, needs no margin waiver');
  assert.equal(((14 * 5) / 206).toFixed(4), '0.3398');
});

test('the parity records are honest about what was and was not established', () => {
  assert.match(sql, /38a4f733-9235-4f62-8f05-932d89c161b2/);
  assert.match(sql, /not inspected \(clip not downloaded\)/);
  assert.match(sql, /one sample/);
});

test('the gateway has a capability record for the Crun Standard endpoint, in std mode', () => {
  const rec = REGISTRY['crun:kling/v3-std'];
  assert.ok(rec, 'without it the gateway cannot dispatch the offer once Crun is first');
  assert.equal(rec.fixed.mode, 'std');
  assert.equal(rec.fixed.model, 'kling/v3');
  assert.equal(REGISTRY['crun:kling/v3'].fixed.mode, 'pro');
  assert.deepEqual(rec.media.image, { ...REGISTRY['crun:kling/v3'].media.image, verifiedAt: '2026-11-17' });
});
