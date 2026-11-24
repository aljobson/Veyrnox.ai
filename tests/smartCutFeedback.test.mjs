import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SMART_CUT_FEEDBACK_COMMENT_MAX,
  parseSmartCutFeedback,
  readSmartCutFeedbackJson,
} from '../lib/smartCutFeedback.js';

const ID = '8f9e48c8-8698-4be6-a197-8399a2cbd0c9';
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const request = (body) => new Request('https://example.test/api/v1/editor/smart-cut-feedback', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});

test('Smart Cut feedback accepts only the minimal bounded contract', () => {
  assert.deepEqual(parseSmartCutFeedback({ response_id: ID, rating: 'up', comment: '  Useful  ', plan_mode: 'local-preview' }), {
    ok: true, feedback: { response_id: ID, rating: 'up', comment: 'Useful', plan_mode: 'local-preview' },
  });
  assert.deepEqual(parseSmartCutFeedback({ response_id: ID, rating: 'down', comment: '  ', plan_mode: 'transcript-silence' }), {
    ok: true, feedback: { response_id: ID, rating: 'down', plan_mode: 'transcript-silence' },
  });
  for (const bad of [
    { response_id: 'not-a-uuid', rating: 'up', plan_mode: 'local-preview' },
    { response_id: ID, rating: 'maybe', plan_mode: 'local-preview' },
    { response_id: ID, rating: 'up', plan_mode: 'other' },
    { response_id: ID, rating: 'up', plan_mode: 'local-preview', transcript: 'private' },
    { response_id: ID, rating: 'up', plan_mode: 'local-preview', comment: 'x'.repeat(SMART_CUT_FEEDBACK_COMMENT_MAX + 1) },
  ]) assert.deepEqual(parseSmartCutFeedback(bad), { ok: false, error: 'invalid_request' });
});

test('Smart Cut feedback body reader enforces its byte ceiling', async () => {
  assert.equal((await readSmartCutFeedbackJson(request(JSON.stringify({ response_id: ID })))).ok, true);
  assert.deepEqual(await readSmartCutFeedbackJson(request('x'.repeat(1500))), { ok: false, error: 'body_too_large' });
});

test('web and shared native surfaces bind one in-memory proposal id to the minimal endpoint payload', () => {
  const web = source('app/veyrnox/_components/SmartCutFeedback.js');
  const planner = source('app/veyrnox/_components/SmartCutPlanner.js');
  const native = source('apps/mobile/src/components/smart-cut/SmartCutFeedback.tsx');
  const nativeRoute = source('apps/mobile/src/app/(app)/smart-cut.tsx');
  for (const text of [web, native]) {
    assert.match(text, /responseId/);
    assert.match(text, /planMode/);
    assert.match(text, /rating/);
    assert.match(text, /comment/);
    assert.doesNotMatch(text, /transcript|script|notes|segments|jobId|projectId|signedUrl/);
    assert.match(text, /submissionId/);
    assert.match(text, /state === ['"]error['"]/);
    assert.match(text, /randomUUID\(\)/);
  }
  assert.match(planner, /crypto\.randomUUID\(\)/);
  assert.match(planner, /setFeedbackTarget\(null\)/);
  assert.match(nativeRoute, /responseId: randomUUID\(\)/);
  assert.match(nativeRoute, /setFeedbackTarget\(null\)/);
});

test('migration keeps feedback private, short-lived, idempotent, erasable and exportable', () => {
  const sql = source('packages/db/schema/supabase/0605_smart_cut_feedback.sql');
  for (const invariant of [
    'FORCE ROW LEVEL SECURITY', 'REVOKE ALL ON public.smart_cut_feedback',
    "GRANT EXECUTE ON FUNCTION public.submit_smart_cut_feedback(text,uuid,text,text,text) TO service_role",
    "interval '180 days'", 'UNIQUE(user_id, response_id)', 'IDEMPOTENCY_CONFLICT',
    'private.purge_smart_cut_feedback', "jobname='veyrnox-purge-smart-cut-feedback'",
    'DROP TRIGGER IF EXISTS users_erase_smart_cut_feedback',
    'AFTER UPDATE OF deleted_at ON public.users', 'DELETE FROM public.smart_cut_feedback WHERE user_id=NEW.id',
    "p_section<>'smart_cut_feedback'", "p_path='/api/v1/editor/smart-cut-feedback'",
  ]) assert.ok(sql.includes(invariant), invariant);
  const table = sql.match(/CREATE TABLE(?: IF NOT EXISTS)? public\.smart_cut_feedback[\s\S]*?CREATE INDEX/)?.[0];
  assert.ok(table, 'feedback table definition');
  assert.doesNotMatch(table, /job_id|project_id|prompt|segments|timings|media_url/);
  assert.ok(source('lib/privacyExport.js').includes("'smart_cut_feedback'"));
});

test('the product and privacy notices state the feedback boundary', () => {
  const copy = source('lib/i18n/messages/app/en/smart-cut.mjs');
  const policy = source('lib/i18n/messages/legal/en/privacy.mjs');
  for (const text of [copy, policy]) {
    assert.match(text, /(?:not sent|do not send).*AI providers/i);
    assert.match(text, /train models/i);
    assert.match(text, /sensitive information/i);
    assert.match(text, /cannot reply/i);
  }
  assert.match(policy, /180 days/);
});
