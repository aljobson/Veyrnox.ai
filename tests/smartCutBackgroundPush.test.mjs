import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0606_smart_cut_push_notifications.sql', import.meta.url), 'utf8');

test('Smart Cut background completion is isolated to terminal speech-analysis jobs', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.push_enqueue_smart_cut_events/);
  assert.match(sql, /j\.inputs->>'kind' = 'speech_analysis'/);
  assert.match(sql, /j\.state IN \('STORED', 'FAILED', 'REFUNDED'\)/);
  assert.match(sql, /j\.updated_at > now\(\) - interval '15 minutes'/);
  assert.match(sql, /CASE WHEN j\.state = 'STORED' THEN 'smart_cut_done' ELSE 'smart_cut_failed' END/);
});

test('Smart Cut push enqueue is idempotent and cannot write jobs or the ledger', () => {
  assert.match(sql, /ON CONFLICT \(job_id, kind\) DO NOTHING/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:jobs|ledger_entries|credit_balances|speech_analyses)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.push_enqueue_smart_cut_events\(INTEGER\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.push_enqueue_smart_cut_events\(INTEGER\) TO service_role/);
});
