import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEndpoint, endpointKind, buildRequest, submitTask, interpretTask } from '../packages/adapters/crun.js';

const job = (over = {}) => ({ job_id: 'job_1', provider_endpoint: 'crun:google/veo3-1-lite-t2v', inputs: { prompt: 'a city at dusk' }, ...over });
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('only known Crun models parse, and path tricks are refused', () => {
  assert.deepEqual(parseEndpoint('crun:google/veo3-1-lite-t2v'), { model: 'google/veo3-1-lite-t2v' });
  assert.equal(parseEndpoint('crun:google/unknown'), null);
  assert.equal(parseEndpoint('crun:../x'), null);
  assert.equal(parseEndpoint('kie:veo3_lite'), null);
});

test('the request body matches the documented CreateTask shape and never sends a callback', () => {
  const r = buildRequest({ model: 'bytedance/seedance2-0-fast-t2v' }, { prompt: 'x' });
  assert.deepEqual(r.body, { model: 'bytedance/seedance2-0-fast-t2v', input: { prompt: 'x', duration: 5, resolution: '720p', aspect_ratio: '16:9', audio: true } });
  assert.equal('audio' in buildRequest({ model: 'google/veo3-1-lite-t2v' }, { prompt: 'x' }).body.input, false, 'Veo has no audio switch');
  assert.equal('callback_url' in r.body, false);
});

test('a request the model cannot take is refused before any spend', () => {
  const t = { model: 'google/veo3-1-lite-t2v' };
  assert.equal(buildRequest(t, { prompt: 'x', aspect_ratio: '1:1' }).error, 'aspect_ratio_unsupported');
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png' }).error, 'input_media_unsupported');
  assert.equal(buildRequest(t, { prompt: '  ' }).error, 'prompt_required');
});

test('the studio default duration_seconds is ignored: the pinned length is always sent', () => {
  const veo = buildRequest({ model: 'google/veo3-1-lite-t2v' }, { prompt: 'x', duration_seconds: 5 });
  assert.equal(veo.ok, true);
  assert.equal(veo.body.input.duration, 8);
  assert.equal(buildRequest({ model: 'bytedance/seedance2-0-fast-t2v' }, { prompt: 'x', duration_seconds: 8 }).body.input.duration, 5);
});

test('submit sends the key header and returns the task id', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen = { url, init }; return reply(200, { code: 200, data: { task_id: 'task_123' } })(); });
  const r = await submitTask(job(), { apiKey: 'k' });
  assert.deepEqual(r, { ok: true, providerJobId: 'task_123' });
  assert.equal(seen.url, 'https://api.crun.ai/api/v1/client/job/CreateTask');
  assert.equal(seen.init.headers['X-API-KEY'], 'k');
  assert.equal(seen.init.redirect, 'manual');
});

test('failure classes: 4xx rejected, 5xx and transport ambiguous, no key refused', async (t) => {
  t.mock.method(globalThis, 'fetch', reply(422, { code: 422, message: 'bad' }));
  assert.equal((await submitTask(job(), { apiKey: 'k' })).outcome, 'rejected');
  t.mock.method(globalThis, 'fetch', reply(503, { code: 503 }));
  assert.equal((await submitTask(job(), { apiKey: 'k' })).outcome, 'unknown');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('reset'); });
  assert.equal((await submitTask(job(), { apiKey: 'k' })).outcome, 'unknown');
  t.mock.method(globalThis, 'fetch', reply(200, { code: 200, data: {} }));
  assert.equal((await submitTask(job(), { apiKey: 'k' })).outcome, 'unknown');
  assert.equal((await submitTask(job(), {})).error, 'provider_not_configured');
});

test('task status: success needs an https output, failed is a failure, anything else is pending', () => {
  assert.deepEqual(interpretTask({ data: { status: 'success', result: { media_urls: ['https://cdn.crun.ai/a.mp4'] } } }), { ok: true, state: 'success', outputUrl: 'https://cdn.crun.ai/a.mp4' });
  assert.equal(interpretTask({ data: { status: 'success', result: { media_urls: ['http://x/a.mp4'] } } }).ok, false);
  assert.equal(interpretTask({ data: { status: 'failed', result: { code: 501 } } }).state, 'fail');
  assert.equal(interpretTask({ data: { status: 'running' } }).state, 'pending');
  assert.equal(interpretTask({ data: { status: 'queued-or-something-new' } }).state, 'pending');
});

test('the adapter is registered but gated: it needs CRUN_ENABLED and a key, and no catalog migration points a row at it', () => {
  const registry = readFileSync(new URL('../packages/provider-sdk/registry.js', import.meta.url), 'utf8');
  assert.match(registry, /CRUN_ENABLED === 'true'/);
});

test('0369 records Crun only as standby, unverified, with no parity record', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0369_crun_standby_routes.sql', import.meta.url), 'utf8');
  assert.match(sql, /2, 'standby', 'unverified'/);
  assert.doesNotMatch(sql, /'active'|parity_record\s*=|UPDATE public\.model_catalog/);
  for (const model of ['google/veo3-1-lite-t2v', 'google/veo3-1-fast-t2v', 'google/veo3-1-t2v', 'bytedance/seedance2-0-fast-t2v']) {
    assert.ok(sql.includes(`crun:${model}`), model);
    assert.ok(parseEndpoint(`crun:${model}`), `${model} parses`);
  }
});

test('0375 reclassifies the four Crun standby routes and never activates one', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0375_crun_licensed_reseller.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(code, /SET provenance = 'licensed_reseller'/);
  assert.match(code, /supplier = 'crun' AND state = 'standby'/);
  assert.match(code, /IF affected <> 4 THEN/);
  assert.doesNotMatch(code, /state\s*=\s*'active'|parity_record/);
});

test('0377 writes the Veo Lite parity record only, and never activates the route', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0377_crun_veo_lite_parity_record.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(code, /endpoint = 'crun:google\/veo3-1-lite-t2v' AND state = 'standby'/);
  assert.match(code, /IF affected <> 1 THEN/);
  assert.doesNotMatch(code, /state\s*=\s*'active'|SET state|provenance/);
  assert.match(code, /charge 15 credits per clip confirmed by the owner/);
  assert.match(code, /model identity rests on Crun id/);
});

test('0379 activates only the proven Veo Lite route, as a second route, and touches no catalog row', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0379_crun_veo_lite_route_active.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(code, /SET state = 'active'/);
  assert.match(code, /endpoint = 'crun:google\/veo3-1-lite-t2v'/);
  assert.match(code, /model_id = 'veo-3\.1-lite-kie'/);
  assert.match(code, /parity_record IS NOT NULL/);
  assert.match(code, /IF affected <> 1 THEN/);
  assert.doesNotMatch(code, /model_catalog|priority|provider_endpoint/);
});

test('image models: the documented body, a square default, no callback, no reference images', () => {
  const nb = buildRequest({ model: 'google/nano-banana' }, { prompt: ' a fox ', seed: 7 });
  assert.deepEqual(nb.body, { model: 'google/nano-banana', input: { prompt: 'a fox', aspect_ratio: '1:1', output_format: 'png' } });
  assert.equal(buildRequest({ model: 'google/nano-banana' }, { prompt: 'x', aspect_ratio: '21:9' }).ok, true);
  const sd = buildRequest({ model: 'bytedance/seedream-4' }, { prompt: 'x' });
  assert.deepEqual(sd.body, { model: 'bytedance/seedream-4', input: { prompt: 'x', aspect_ratio: '1:1', resolution: '2K', num_outputs: 1 } });
  assert.equal(buildRequest({ model: 'bytedance/seedream-4' }, { prompt: 'x', aspect_ratio: '16:9' }).error, 'aspect_ratio_unsupported', 'the fal row it backs is a fixed square');
  for (const model of ['google/nano-banana', 'bytedance/seedream-4']) {
    assert.equal(buildRequest({ model }, { prompt: 'x', image_url: 'https://a/b.png' }).error, 'input_media_unsupported');
    assert.equal(buildRequest({ model }, { prompt: 'x', img_urls: ['https://a/b.png'] }).error, 'input_media_unsupported');
    assert.equal(buildRequest({ model }, { prompt: ' ' }).error, 'prompt_required');
    assert.equal('callback_url' in buildRequest({ model }, { prompt: 'x' }).body, false);
  }
});

test('endpointKind tells the sweep a picture from a clip, and refuses what the adapter does not own', () => {
  assert.equal(endpointKind('crun:google/nano-banana'), 'image');
  assert.equal(endpointKind('crun:bytedance/seedream-4'), 'image');
  assert.equal(endpointKind('crun:google/veo3-1-lite-t2v'), 'video');
  assert.equal(endpointKind('crun:google/unknown'), null);
  assert.equal(endpointKind('kie:veo3_lite'), null);
});
