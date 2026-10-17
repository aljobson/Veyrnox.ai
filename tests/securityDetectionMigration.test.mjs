// 0342 (ADR-0104): one alert per event hour, and a missing second factor is
// its own low-severity rule. The behaviour itself was run on Postgres; this
// pins the two properties in the SQL so a later rewrite of the function keeps them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0342_security_detection_dedupe.sql', import.meta.url), 'utf8');

test('the alert key uses the hour of the newest event, not the hour of the run', () => {
    assert.match(sql, /date_trunc\('hour', h\.last_at AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(sql, /v_bucket|date_trunc\('hour', now\(\)\)/);
});

test('SEC-003 leaves out missing-second-factor refusals, which SEC-007 reads at low severity', () => {
    assert.match(sql, /'SEC-003'[\s\S]{0,200}e\.action <> 'admin\.mfa_required'/);
    assert.match(sql, /'SEC-007'[\s\S]{0,200}e\.action = 'admin\.mfa_required'/);
    assert.match(sql, /\('SEC-007', [^)]*'low'/);
});

test('the function keeps its privileges: service role only', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.run_security_detection\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.run_security_detection\(\) TO service_role/);
    assert.match(sql, /SET search_path = ''/);
});
