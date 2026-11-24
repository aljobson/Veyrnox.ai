import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../packages/db/schema/supabase/0602_music_candidate_cancel_projection.sql', import.meta.url), 'utf8');

test('Music cancellation projection preserves source credits without adding a mutation path', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.music_get_generation\(p_auth_id TEXT,p_request_id UUID\)/);
  assert.match(sql, /'error_code',c\.failure_code,'credits',j\.credits/);
  assert.match(sql, /JOIN public\.jobs j ON j\.id=c\.job_id AND j\.user_id=c\.user_id/);
  assert.match(sql, /PERFORM public\.music_project_candidate\(v_job\)/);
  assert.doesNotMatch(sql, /cancel_user_job|ledger_refund|UPDATE public\.jobs|INSERT INTO public\.ledger_entries/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.music_get_generation\(TEXT,UUID\) FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_get_generation\(TEXT,UUID\) TO service_role/);
});
