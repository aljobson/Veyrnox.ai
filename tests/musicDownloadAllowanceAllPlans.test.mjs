import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Owner, 2026-11-14: the existing Credit Subscription covers Audio. 0467 gave a
// download allowance to three monthly plans only and refused every other active
// plan with PLAN_UNAVAILABLE, while a non-subscriber got 7. 0505 corrects that.
const DIR = new URL('../packages/db/schema/supabase/', import.meta.url);
const sql = readFileSync(new URL('0505_music_download_allowance_all_plans.sql', DIR), 'utf8');
const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

test('every active plan gets an allowance, and no plan is refused as unavailable', () => {
  assert.doesNotMatch(code, /PLAN_UNAVAILABLE/);
  const body = code.match(/v_allowance := CASE v_sub\.plan_id([\s\S]*?)END;/);
  assert.ok(body, 'allowance CASE not found');
  const tiers = Object.fromEntries([...body[1].matchAll(/WHEN '([a-z-]+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(tiers, {
    'starter-monthly': 20, 'starter-yearly': 20,
    'plus-monthly': 60, 'plus-yearly': 60,
    'ultra-monthly': 60, 'ultra-yearly': 60,
  });
  const fallback = body[1].match(/ELSE (\d+)/);
  assert.ok(fallback, 'the CASE must have an ELSE');
  assert.ok(Number(fallback[1]) >= 7, 'a paying subscriber never gets less than the free allowance of 7');
  assert.match(code, /v_kind := 'free_trial'; v_allowance := 7;/);
});

test('a yearly plan is counted per monthly cycle, and a monthly plan keeps its period key', () => {
  assert.match(code, /p\.billing_interval = 'year'/);
  assert.match(code, /v_cycle := LEAST\(12, 1 \+/);
  assert.match(code, /':cycle:'\s*\|\| extract\(epoch from v_sub\.cycle_anchor\)::bigint::text \|\| ':' \|\| v_cycle::text/);
  assert.match(code, /v_expires := LEAST\(v_sub\.cycle_anchor \+ make_interval\(months => v_cycle\), v_sub\.current_period_end\);/);
  assert.match(code, /IF v_expires <= now\(\) THEN v_expires := v_sub\.current_period_end; END IF;/);
  // Unchanged from 0467, so periods and claims already recorded still match.
  assert.ok(code.includes("v_period_key := 'subscription:' || v_sub.id::text || ':' || extract(epoch from v_sub.current_period_end)::bigint::text;"));
});

test('the function keeps its security settings and privileges', () => {
  assert.match(code, /^CREATE OR REPLACE FUNCTION public\.music_quote_audio_export\(/m);
  assert.match(code, /SECURITY DEFINER SET search_path = ''/);
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;'));
  assert.ok(code.includes('GRANT EXECUTE ON FUNCTION public.music_quote_audio_export(TEXT,UUID,UUID,TEXT) TO service_role;'));
  assert.doesNotMatch(code, /ledger_|credit_balances/);
});
