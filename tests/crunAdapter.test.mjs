import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEndpoint, endpointKind, buildRequest, submitTask, interpretTask,
  classifyCreateTaskResponse, classifyTaskInfoResponse, sanitizeCrunFailure } from '../packages/adapters/crun.js';
import { SOURCE_PROMPT_RECORDS } from '../app/veyrnox/_lib/sourcePromptRecords.js';

const job = (over = {}) => ({ job_id: 'job_1', provider_endpoint: 'crun:google/veo3-1-lite-t2v', inputs: { prompt: 'a city at dusk' }, ...over });
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Crun serializes captured trailing newlines and CRLF byte for byte', async (t) => {
  const outbound = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    outbound.push(JSON.parse(init.body));
    return reply(200, { code: 200, data: { task_id: 'exact_prompt_task' } })();
  });
  // Exercise the changed Fast builder even though Warrior Standoff is assigned
  // Kling: this is a CRLF serialization fixture, not a routing change.
  for (const id of ['pov-dragon-flight', 'community-warrior-standoff']) {
    const prompt = SOURCE_PROMPT_RECORDS[id].prompt;
    if (id === 'pov-dragon-flight') assert.ok(prompt.endsWith('\n\n'));
    else assert.ok(prompt.includes('\r\n'));
    const result = await submitTask(job({ provider_endpoint: 'crun:bytedance/seedance2-0-fast-t2v', inputs: { prompt } }), { apiKey: 'test-key' });
    assert.equal(result.ok, true, id);
    assert.deepEqual(Buffer.from(outbound.at(-1).input.prompt), Buffer.from(prompt), id);
    assert.deepEqual(outbound.at(-1), { model: 'bytedance/seedance2-0-fast-t2v', input: { prompt, duration: 5, resolution: '720p', aspect_ratio: '16:9', audio: true } });
  }
  for (const prompt of ['', ' \t\r\n', undefined, null, 42]) {
    const result = await submitTask(job({ provider_endpoint: 'crun:bytedance/seedance2-0-fast-t2v', inputs: { prompt } }), { apiKey: 'test-key' });
    assert.deepEqual(result, { ok: false, outcome: 'rejected', error: 'prompt_required', clientError: 'prompt_required' });
  }
  assert.equal(outbound.length, 2, 'empty inputs never reach the provider');
});

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

test('Suno simple and custom payloads are strict, normalized, and bounded', () => {
  const target = parseEndpoint('crun:suno/music-generate');
  assert.deepEqual(target, { model: 'suno/music-generate' });
  assert.equal(endpointKind('crun:suno/music-generate'), 'audio');
  assert.deepEqual(buildRequest(target, { mode: 'simple', prompt: 'rain on glass', instrumental: false, suno_model: 'chirp-v6' }), {
    ok: true, body: { model: 'suno/music-generate', input: { mode: 'simple', prompt: 'rain on glass', instrumental: false, model: 'v6' } },
  });
  assert.deepEqual(buildRequest(target, { mode: 'custom', instrumental: false, suno_model: 'v6_wild', title: 'Afterlight',
    tags: 'dream pop', lyrics: 'Stay', negative_tags: 'harsh'.repeat(40), vocal_gender: 'f', style_weight: .75,
    weirdness_constraint: .25, duration: 135, variety: 4 }).body.input, {
    mode: 'custom', instrumental: false, model: 'v6_wild', tags: 'dream pop', title: 'Afterlight', lyrics: 'Stay',
    negative_tags: 'harsh'.repeat(40), vocal_gender: 'f', style_weight: .75, weirdness_constraint: .25, duration: 135, variety: 4,
  });
  assert.equal(buildRequest(target, { mode: 'custom', instrumental: false, tags: 'rock' }).error, 'inputs_invalid:lyrics');
  assert.equal(buildRequest(target, { mode: 'simple', instrumental: true, prompt: 'x', lyrics: 'not simple' }).error, 'inputs_invalid:mode');
  assert.equal(buildRequest(target, { mode: 'custom', instrumental: true, tags: 'x', duration: 136 }).error, 'inputs_invalid:duration');
  assert.equal(buildRequest(target, { mode: 'simple', instrumental: true, prompt: '🎵'.repeat(500) }).ok, true);
  assert.equal(buildRequest(target, { mode: 'simple', instrumental: true, prompt: '🎵'.repeat(501) }).error, 'inputs_invalid:prompt');
});

test('CreateTask and TaskInfo classifiers never retain vendor text', () => {
  const sentinel = 'SECRET-VENDOR-SENTINEL';
  const rejected = classifyCreateTaskResponse(422, { code: 422, message: sentinel, msg: sentinel });
  assert.deepEqual(rejected, { httpStatus: 422, bodyCode: 422, class: 'rejected', errorCode: 'provider_input_rejected' });
  assert.doesNotMatch(JSON.stringify(sanitizeCrunFailure(rejected)), /SECRET-VENDOR-SENTINEL/);
  assert.equal(classifyCreateTaskResponse(429, { code: 429, message: sentinel }).class, 'deferred');
  assert.equal(classifyCreateTaskResponse(429, { code: 200, message: sentinel }).class, 'deferred');
  assert.equal(classifyCreateTaskResponse(401, { code: 200, message: sentinel }).class, 'account');
  assert.equal(classifyCreateTaskResponse(200, { code: 429, message: sentinel }).class, 'deferred');
  assert.equal(classifyCreateTaskResponse(400, { code: 401, message: sentinel }).class, 'rejected');
  assert.equal(classifyCreateTaskResponse(503, { code: 503, message: sentinel }).class, 'unknown');
  assert.equal(classifyCreateTaskResponse(200, { code: 200, data: {} }).class, 'unknown');
  assert.deepEqual(classifyTaskInfoResponse(200, { code: 501, message: sentinel }), {
    httpStatus: 200, bodyCode: 501, ok: true, state: 'fail', errorCode: 'provider_task_failed',
  });
  assert.equal(classifyTaskInfoResponse(501, null).ok, false);
  // A failed task may arrive as HTTP 501 with body code 501: still terminal, still refundable.
  assert.deepEqual(classifyTaskInfoResponse(501, { code: 501, message: sentinel }), {
    httpStatus: 501, bodyCode: 501, ok: true, state: 'fail', errorCode: 'provider_task_failed',
  });
  assert.equal(classifyTaskInfoResponse(200, { code: 200, data: { status: 'failed', result: { code: sentinel } } }).errorCode,
    'provider_task_failed');
  assert.equal(classifyCreateTaskResponse(503, { code: 422, message: sentinel }).class, 'unknown');
  const unreadable = classifyTaskInfoResponse(403, { code: 403, message: sentinel });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.errorCode, 'provider_status_unavailable');
  assert.doesNotMatch(JSON.stringify(unreadable), /SECRET-VENDOR-SENTINEL/);
  assert.equal(classifyTaskInfoResponse(200, { code: 200, data: { status: 'success', suno_data: [
    { suno_audio_url: 'https://unverified.example/song.mp3' },
  ] } }, 'audio').outputUrl, 'https://unverified.example/song.mp3');
});

test('a request the model cannot take is refused before any spend', () => {
  const t = { model: 'google/veo3-1-lite-t2v' };
  assert.equal(buildRequest(t, { prompt: 'x', aspect_ratio: '1:1' }).error, 'aspect_ratio_unsupported');
  assert.equal(buildRequest(t, { prompt: 'x', reference_urls: ['https://a/b.png'] }).error, 'input_media_unsupported');
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

test('generic Crun callers retain rejected/unknown outcomes while music receives typed scopes', async (t) => {
  const replies = [
    [401, { code: 401, message: 'vendor secret' }],
    [402, { code: 402, message: 'vendor secret' }],
    [429, { code: 429, message: 'vendor secret' }],
    [455, { code: 455, message: 'vendor secret' }],
  ];
  let index = 0;
  t.mock.method(globalThis, 'fetch', async () => reply(...replies[index++])());
  for (const scope of ['account', 'account', 'deferred', 'route']) {
    const result = await submitTask(job(), { apiKey: 'k' });
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.scope, scope);
    assert.doesNotMatch(JSON.stringify(result), /vendor secret/);
  }
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

test('Nano Banana 2.1 sends a 1K picture, the row Crun prices at 3 credits, and no reference images', () => {
  const r = buildRequest({ model: 'google/nano-banana-2-1' }, { prompt: 'a fox' });
  assert.deepEqual(r.body, { model: 'google/nano-banana-2-1', input: { prompt: 'a fox', aspect_ratio: '1:1', resolution: '1K' } });
  assert.equal(endpointKind('crun:google/nano-banana-2-1'), 'image');
  assert.equal(buildRequest({ model: 'google/nano-banana-2-1' }, { prompt: 'x', img_urls: ['https://a/b.png'] }).error, 'input_media_unsupported');
});

test('Kling 3.0 is image-to-video in pro mode with audio off and one required start frame', () => {
  const t = { model: 'kling/v3' };
  assert.deepEqual(parseEndpoint('crun:kling/v3'), t);
  assert.equal(endpointKind('crun:kling/v3'), 'video');
  const r = buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png' });
  assert.deepEqual(r.body, { model: 'kling/v3', input: { mode: 'pro', prompt: 'x', duration: 5, audio: false, img_urls: ['https://a/b.png'], multi_shots: false } });
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png', duration_seconds: 10 }).body.input.duration, 10);
  assert.equal(buildRequest(t, { prompt: 'x' }).error, 'inputs_invalid:image_url');
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'http://a/b.png' }).error, 'inputs_invalid:image_url');
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png', duration_seconds: 7 }).error, 'duration_not_supported');
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png', aspect_ratio: '16:9' }).error, 'inputs_key_not_allowed:aspect_ratio');
  assert.equal(buildRequest(t, { prompt: 'see @hero:v2 run', image_url: 'https://a/b.png' }).body.input.prompt, 'see hero:v2 run');
});

test('Kling 2.6 Pro is text-to-video, audio off, and refuses a source image', () => {
  const t = { model: 'kling/v2-6' };
  const r = buildRequest(t, { prompt: 'x' });
  assert.deepEqual(r.body, { model: 'kling/v2-6', input: { mode: 'pro', prompt: 'x', duration: 5, audio: false, aspect_ratio: '16:9' } });
  assert.equal(buildRequest(t, { prompt: 'x', aspect_ratio: '1:1', duration_seconds: 10 }).body.input.duration, 10);
  assert.equal(buildRequest(t, { prompt: 'x', aspect_ratio: '4:3' }).error, 'inputs_invalid:aspect_ratio');
  assert.equal(buildRequest(t, { prompt: 'x', image_url: 'https://a/b.png' }).error, 'inputs_key_not_allowed:image_url');
  assert.equal(buildRequest(t, { prompt: '  ' }).error, 'prompt_required');
  assert.equal('callback_url' in r.body, false);
});

test('a Kling prompt over Crun\'s documented 2,500 characters is refused before the debit', () => {
  assert.equal(buildRequest({ model: 'kling/v2-6' }, { prompt: 'x'.repeat(2500) }).ok, true);
  assert.equal(buildRequest({ model: 'kling/v2-6' }, { prompt: 'x'.repeat(2501) }).error, 'inputs_invalid:prompt');
  assert.equal(buildRequest({ model: 'kling/v3' }, { prompt: 'x'.repeat(2501), image_url: 'https://a/b.png' }).error, 'inputs_invalid:prompt');
});

test('Wan Animate replace is a strict poll-only whole-job request', () => {
  const endpoint = 'crun:wan/2-2-animate-replace', target = parseEndpoint(endpoint);
  const inputs = { image_url: 'https://owned.test/person.jpg', video_url: 'https://owned.test/source.mp4' };
  assert.deepEqual(target, { model: 'wan/2-2-animate-replace' });
  assert.equal(endpointKind(endpoint), 'video');
  for (const image_url of [inputs.image_url, [inputs.image_url]]) {
    assert.deepEqual(buildRequest(target, { ...inputs, image_url }), { ok: true, body: {
      model: 'wan/2-2-animate-replace', input: { img_urls: [inputs.image_url], video_urls: [inputs.video_url], resolution: '720P' },
    } });
  }
  assert.equal(buildRequest(target, { ...inputs, duration_seconds: 5 }).ok, true);
  for (const key of ['callback_url', 'model', 'resolution', 'prompt', 'img_urls', 'unknown']) {
    assert.equal(buildRequest(target, { ...inputs, [key]: 'override' }).error, `inputs_key_not_allowed:${key}`);
  }
  for (const key of ['image_url', 'video_url']) for (const value of [undefined, [], ['https://a.test/a', 'https://b.test/b'], 'http://owned.test/file', 'https://', 42]) {
    assert.equal(buildRequest(target, { ...inputs, [key]: value }).ok, false, `${key}: ${JSON.stringify(value)}`);
  }
  assert.equal(buildRequest(target, { ...inputs, duration_seconds: 10 }).error, 'duration_not_supported');
});

test('Kling 3.0 Standard is the same Crun model in std mode (720p); Pro and 2.6 keep pro', () => {
  const std = { model: 'kling/v3-std' };
  assert.deepEqual(parseEndpoint('crun:kling/v3-std'), std);
  assert.equal(endpointKind('crun:kling/v3-std'), 'video');
  const r = buildRequest(std, { prompt: 'x', image_url: 'https://a/b.png', duration_seconds: 10 });
  assert.deepEqual(r.body, { model: 'kling/v3', input: { mode: 'std', prompt: 'x', duration: 10, audio: false, img_urls: ['https://a/b.png'], multi_shots: false } });
  assert.equal(buildRequest({ model: 'kling/v3' }, { prompt: 'x', image_url: 'https://a/b.png' }).body.input.mode, 'pro');
  assert.equal(buildRequest({ model: 'kling/v2-6' }, { prompt: 'x' }).body.input.mode, 'pro');
  assert.equal(buildRequest(std, { prompt: 'x' }).error, 'inputs_invalid:image_url');
  assert.equal(buildRequest(std, { prompt: 'x', image_url: 'https://a/b.png', duration_seconds: 7 }).error, 'duration_not_supported');
  assert.equal(parseEndpoint('crun:kling/v3-4k'), null, 'only the tiers we price are accepted');
});
