import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('packages/db/schema/supabase/0585_crun_veo_31_first.sql', 'utf8');
const CAP = 0.01796; // ADR-0037

test('225 Crun credits at 206 per $1 is the recorded cost, inside the 70-credit floor with kie', () => {
  assert.equal((225 / 206).toFixed(4), '1.0922');
  assert.ok(1.0922 <= 70 * CAP, 'Crun inside the floor');
  assert.ok(1.25 <= 70 * CAP, 'kie, now second, inside the floor so a hop needs no waiver');
});

test('it records the probe on the Crun route, then reorders through the guarded function', () => {
  assert.match(sql, /586f2742-113c-43de-875a-12e2c6fba2fc/);
  assert.match(sql, /crun:google\/veo3-1-t2v/);
  assert.match(sql, /public\.model_route_reorder\(/);
  assert.match(sql, /CASE supplier WHEN 'crun' THEN 0 ELSE 1 END/);
  assert.match(sql, /provider <> 'crun'/, 'reorder skipped when Crun is already first');
});

test('each UPDATE asserts one row, and price and gating are not touched', () => {
  assert.equal((sql.match(/IF affected <> 1 THEN/g) || []).length, 2);
  assert.match(sql, /credits_5s = 70/);
  assert.doesNotMatch(sql, /SET\s+credits_5s|,\s*credits_5s\s*=/, 'the price is read, never set');
  assert.doesNotMatch(sql, /SET\s+gated|,\s*gated\s*=/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO/i);
});

test('it asserts the end state: Crun first, kie second', () => {
  assert.match(sql, /priority = 1 AND supplier = 'crun' AND endpoint = 'crun:google\/veo3-1-t2v'/);
  assert.match(sql, /priority = 2 AND supplier = 'kie' AND endpoint = 'veo:veo3'/);
});

test('the header states what was not established', () => {
  assert.match(sql, /NOT established: the charge in Crun's own log/);
  assert.match(sql, /estimated=false/);
});
