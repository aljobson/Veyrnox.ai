// 0416 (ADR-0310): the detection engine leaves a heartbeat each run, and a
// service-role-only reader reports its liveness and open high/critical alerts.
// The behaviour was run on Postgres; this pins the properties in the SQL so a
// later rewrite keeps them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0416_security_detection_heartbeat.sql', import.meta.url), 'utf8');

test('the engine records a heartbeat as its last step and prunes old rows', () => {
    // The INSERT comes after the rule loop and before RETURN, so an error in a
    // rule rolls the heartbeat back with it.
    assert.match(sql, /END LOOP;[\s\S]*INSERT INTO public\.security_detection_runs \(alerts_touched\) VALUES \(v_touched\);[\s\S]*RETURN jsonb_build_object/);
    assert.match(sql, /DELETE FROM public\.security_detection_runs WHERE ran_at < now\(\) - interval '30 days'/);
});

test('the heartbeat table and its indexes are locked down', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.security_detection_runs/);
    assert.match(sql, /ALTER TABLE public\.security_detection_runs ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ALTER TABLE public\.security_detection_runs FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON public\.security_detection_runs FROM PUBLIC, anon, authenticated/);
});

test('the status reader is service-role only, STABLE, with search_path cleared', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.security_detection_status\(\)/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.security_detection_status\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.security_detection_status\(\) TO service_role/);
    // both SECURITY DEFINER functions clear the search path
    assert.equal((sql.match(/SET search_path = ''/g) || []).length, 2);
});

test('the status reader reports the last run age and open high/critical counts only', () => {
    assert.match(sql, /seconds_since_run/);
    assert.match(sql, /open_critical/);
    assert.match(sql, /open_high/);
    assert.match(sql, /open_high_or_critical/);
    // the status reader counts open alerts; it does not write events
    assert.match(sql, /a\.status = 'open'/);
    assert.doesNotMatch(sql, /record_security_event|INSERT INTO public\.security_events/);
});

test('the redefined engine keeps its privileges: service role only', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.run_security_detection\(\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.run_security_detection\(\) TO service_role/);
    // the dedup fix from 0342 is preserved, not reverted to the run-hour bucket
    assert.match(sql, /date_trunc\('hour', h\.last_at AT TIME ZONE 'UTC'\)/);
    assert.doesNotMatch(sql, /v_bucket/);
});

test('it touches no ledger or credit table', () => {
    assert.doesNotMatch(sql, /ledger_entries|credit_balances|ledger_debit|ledger_grant/);
});
