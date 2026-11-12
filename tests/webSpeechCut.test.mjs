import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPEECH_PATH,
  clipsOverLimit,
  fetchSpeechQuote,
  pollSpeech,
  speechErrorKey,
  speechTotal,
  startSpeech,
} from '../app/veyrnox/_lib/speechCutClient.js';

const analysis = { version: 1, assetId: 'job-a', duration: 8, provider: 'fal-scribe-v2', transcript: 'Hello world', language: 'en', chunks: [{ start: 0.2, end: 1, text: 'Hello world' }] };
const err = (status, code, body = {}) => Object.assign(new Error(code), { status, code, body });

test('quote reads the typed price and treats 501 as unavailable', async () => {
  const seen = [];
  const quote = await fetchSpeechQuote(async (path) => { seen.push(path); return { credits: 3, max_seconds: 60, languages: ['en'] }; });
  assert.deepEqual(quote, { credits: 3, maxSeconds: 60 });
  assert.equal(seen[0], `${SPEECH_PATH}/quote`);
  assert.equal(await fetchSpeechQuote(async () => { throw err(501, 'speech_cut_unavailable'); }), null);
  await assert.rejects(fetchSpeechQuote(async () => ({ credits: 0, max_seconds: 60, languages: [] })), /bad_response/);
  await assert.rejects(fetchSpeechQuote(async () => { throw err(500, 'gateway_error'); }));
});

test('start posts only the owned job, the duration, the key and the price the person saw', async () => {
  let call;
  const out = await startSpeech(async (path, init) => { call = { path, init }; return { id: 'a1', status: 'queued', progress: 'queued' }; },
    { jobId: 'b8f1c0de-0000-4000-8000-000000000001', duration: 8, key: 'smart-cut-key-0001', credits: 3 });
  assert.equal(call.path, SPEECH_PATH);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { source: { type: 'job', jobId: 'b8f1c0de-0000-4000-8000-000000000001' }, duration: 8, idempotencyKey: 'smart-cut-key-0001', expectedCredits: 3 });
  assert.equal(out.status, 'queued');
});

test('a completed analysis is re-validated and a bad one fails closed', async () => {
  const good = await startSpeech(async () => ({ id: 'a1', status: 'completed', analysis }), { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 });
  assert.equal(good.analysis.assetId, 'job-a');
  await assert.rejects(startSpeech(async () => ({ id: 'a1', status: 'completed', analysis: { ...analysis, version: 9 } }), { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 }), { code: 'outcome_pending' });
});

test('silent clips come back as no speech, not as an analysis', async () => {
  const out = await startSpeech(async () => ({ id: 'a1', status: 'completed', speech: false, refunded: true }), { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 });
  assert.equal(out.speech, false);
  assert.equal(out.analysis, undefined);
});

test('a definite refusal is thrown, an unclear server error recovers by key without a second charge', async () => {
  const paths = [];
  await assert.rejects(startSpeech(async () => { throw err(402, 'insufficient_balance'); }, { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 }), { code: 'insufficient_balance' });
  const out = await startSpeech(async (path) => {
    paths.push(path);
    if (path === SPEECH_PATH) throw err(503, 'gateway_error');
    return { id: 'a1', status: 'queued' };
  }, { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 });
  assert.equal(out.status, 'queued');
  assert.deepEqual(paths, [SPEECH_PATH, `${SPEECH_PATH}/by-key/smart-cut-key-0001`]);
  await assert.rejects(startSpeech(async () => { throw err(503, 'gateway_error'); }, { jobId: 'job-a', duration: 8, key: 'smart-cut-key-0001', credits: 3 }), { code: 'outcome_pending' });
});

test('polling follows queued to completed, reports progress and stops on abort or deadline', async () => {
  const replies = [{ id: 'a1', status: 'queued', progress: 'queued' }, { id: 'a1', status: 'queued', progress: 'transcribing' }, { id: 'a1', status: 'completed', analysis }];
  const progress = [];
  const out = await pollSpeech(async () => replies.shift(), 'smart-cut-key-0001', { signal: new AbortController().signal, onProgress: (p) => progress.push(p), sleep: async () => {} });
  assert.equal(out.status, 'completed');
  assert.deepEqual(progress, ['queued', 'transcribing']);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(pollSpeech(async () => ({ id: 'a1', status: 'queued' }), 'smart-cut-key-0001', { signal: controller.signal, sleep: async () => {} }), { code: 'cancelled' });

  let now = 0;
  await assert.rejects(pollSpeech(async () => ({ id: 'a1', status: 'queued' }), 'smart-cut-key-0001', { signal: new AbortController().signal, sleep: async () => { now += 100000; }, now: () => now }), { code: 'poll_timeout' });
});

test('price and eligibility helpers use the saved clip lengths', () => {
  assert.equal(speechTotal(3, 4), 12);
  const clips = [{ job_id: 'a', duration: 59.9 }, { job_id: 'b', duration: 60.5 }, { job_id: 'c' }];
  assert.deepEqual(clipsOverLimit(clips, 60).map((clip) => clip.job_id), ['b', 'c']);
});

test('every server refusal maps to a message key, with a safe default', () => {
  for (const code of ['source_too_long', 'duration_mismatch', 'price_changed', 'speech_cut_unavailable', 'provider_admission_paused', 'insufficient_balance', 'account_frozen', 'rate_limited', 'speech_gate_cooldown', 'poll_timeout', 'outcome_pending', 'idempotency_conflict']) {
    assert.match(speechErrorKey({ code }), /^app\.smartCut\.analyse\.error\./, code);
  }
  assert.equal(speechErrorKey({ code: 'something_new' }), 'app.smartCut.analyse.error.failed');
  assert.equal(speechErrorKey(null), 'app.smartCut.analyse.error.failed');
});
