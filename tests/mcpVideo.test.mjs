import test from 'node:test';
import assert from 'node:assert/strict';
import { startMcpVideo, startMcpEdit } from '../lib/mcpVideo.js';

const VIDEO = { id: 'kling-i2v', modality: 'image-to-video', credits: 10, durations: [5, 10], capabilities: { media: { image: { maxFiles: 1 } } } };
const ARGS = { model_id: VIDEO.id, prompt: 'A slow dolly shot', confirmed_credits: 10, user_approved: true, idempotency_key: 'mcp-video-0001' };
const ASSET = '3f2b8c1e-5a47-4d3e-9b0a-1c2d3e4f5a6b';

function harness({ model = VIDEO, created = { status: 202, body: { job_id: 'j1', state: 'queued' } }, catalogFails = false } = {}) {
  const calls = { create: [] };
  return {
    calls,
    deps: {
      async findModel(id) { if (catalogFails) throw new Error('down'); return id === model?.id ? model : undefined; },
      async createGeneration(body) { calls.create.push(body); return { response: { ok: created.status < 400, status: created.status }, data: created.body }; },
    },
  };
}
const video = async (args, options) => { const h = harness(options); return { ...h, result: await startMcpVideo(args, h.deps) }; };
const edit = async (args, options) => { const h = harness(options); return { ...h, result: await startMcpEdit(args, h.deps) }; };

test('a confirmed video is sent once to the generation route with only the allowed inputs', async () => {
  const { result, calls } = await video({ ...ARGS, duration_seconds: 5, aspect_ratio: '9:16', seed: 3, injected: 'x' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.create, [{
    model_id: VIDEO.id, idempotency_key: 'mcp-video-0001', confirmed_credits: 10,
    inputs: { prompt: 'A slow dolly shot', aspect_ratio: '9:16', duration_seconds: 5, seed: 3 },
    references: [], consent: false,
  }]);
});

test('video is priced per five-second unit and the confirmation must match', async () => {
  const ok = await video({ ...ARGS, duration_seconds: 10, confirmed_credits: 20 });
  assert.equal(ok.result.ok, true);
  const wrong = await video({ ...ARGS, duration_seconds: 10, confirmed_credits: 10 });
  assert.deepEqual([wrong.result.status, wrong.result.body.error, wrong.result.body.expected_credits, wrong.calls.create.length], [409, 'credit_confirmation_mismatch', 20, 0]);
});

test('only video models are accepted, and the clip editor is not started from this tool', async () => {
  for (const [id, modality] of [['x', 'text-to-image'], ['x', 'text-to-audio'], ['x', undefined], ['clip-edit', 'video']]) {
    const { result, calls } = await video({ ...ARGS, model_id: id }, { model: { ...VIDEO, id, modality } });
    assert.deepEqual([result.ok, result.status, result.body.error, calls.create.length], [false, 400, 'mcp_video_only', 0], `${id} ${modality}`);
  }
});

test('without the user\'s approval nothing is sent, even with the right price', async () => {
  const { result, calls } = await video({ ...ARGS, user_approved: undefined });
  assert.deepEqual([result.status, result.body.error, calls.create.length], [400, 'approval_required', 0]);
});

test('there is no per-call price cap: a dear video model is allowed at its exact price', async () => {
  const { result } = await video({ ...ARGS, confirmed_credits: 500 }, { model: { ...VIDEO, credits: 500 } });
  assert.equal(result.ok, true);
});

test('a source file needs consent and obeys the model cap; with consent it is passed by id and slot only', async () => {
  const source = { asset_id: ASSET, slot: 'image' };
  const noConsent = await video({ ...ARGS, source_assets: [source] });
  assert.deepEqual([noConsent.result.status, noConsent.result.body.error, noConsent.calls.create.length], [400, 'consent_required', 0]);
  const tooMany = await video({ ...ARGS, consent: true, source_assets: [source, source, source] });
  assert.deepEqual([tooMany.result.body.error, tooMany.calls.create.length], ['source_count_exceeded', 0]);
  const ok = await video({ ...ARGS, consent: true, source_assets: [{ ...source, url: 'https://evil.example/x.mp4' }] });
  assert.deepEqual([ok.calls.create[0].references, ok.calls.create[0].consent], [[{ ...source, origin: 'asset' }], true]);
});

test('consent is not sent when there is no source, whatever the caller says', async () => {
  const { calls } = await video({ ...ARGS, consent: true });
  assert.equal(calls.create[0].consent, false);
});

test('unknown model, unavailable catalog and unsupported duration are refused cleanly', async () => {
  assert.deepEqual((await video({ ...ARGS, model_id: 'nope' })).result.status, 404);
  assert.deepEqual((await video(ARGS, { catalogFails: true })).result.status, 503);
  const long = await video({ ...ARGS, duration_seconds: 5 }, { model: { ...VIDEO, durations: [10] } });
  assert.deepEqual([long.result.status, long.result.body.error, long.calls.create.length], [400, 'duration_not_supported', 0]);
});

test('a refusal from the generation route is passed through untouched', async () => {
  for (const status of [400, 402, 409, 429, 502]) {
    const { result } = await video(ARGS, { created: { status, body: { error: 'insufficient_credits' } } });
    assert.deepEqual([result.ok, result.status, result.body], [false, status, { error: 'insufficient_credits' }]);
  }
});

const EDIT = { clips: [{ asset_id: ASSET, in_s: 0, out_s: 4 }], confirmed_credits: 6, user_approved: true, idempotency_key: 'mcp-edit-00001' };

test('an edit goes to the generation route as the clip editor model, with no sources and no consent', async () => {
  const { result, calls } = await edit({ ...EDIT, audio: { asset_id: ASSET, offset_s: 0 }, captions: { preset: 'simple' }, model_id: 'sora' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.create, [{
    model_id: 'clip-edit', idempotency_key: 'mcp-edit-00001', confirmed_credits: 6,
    inputs: { clips: EDIT.clips, audio: { asset_id: ASSET, offset_s: 0 }, captions: { preset: 'simple' } },
    source_assets: [], consent: false,
  }]);
});

test('a quote (confirmed 0) returns the route\'s expected price and spends nothing', async () => {
  const { result } = await edit({ ...EDIT, confirmed_credits: 0 }, { created: { status: 409, body: { error: 'credit_confirmation_mismatch', expected_credits: 6, confirmed_credits: 0 } } });
  assert.deepEqual([result.ok, result.status, result.body.expected_credits], [false, 409, 6]);
});

test('a real charge for an edit needs the user\'s approval, but a quote does not', async () => {
  const unapproved = await edit({ ...EDIT, user_approved: undefined });
  assert.deepEqual([unapproved.result.body.error, unapproved.calls.create.length], ['approval_required', 0]);
  const quote = await edit({ ...EDIT, confirmed_credits: 0, user_approved: undefined }, { created: { status: 409, body: { error: 'credit_confirmation_mismatch', expected_credits: 600 } } });
  assert.deepEqual([quote.result.status, quote.result.body.expected_credits, quote.calls.create.length], [409, 600, 1]);
});

test('route refusals for an edit (not owned, not a video, too long) pass through', async () => {
  for (const [status, error] of [[404, 'asset_not_found'], [400, 'clip_not_video'], [400, 'too_long']]) {
    const { result } = await edit(EDIT, { created: { status, body: { error } } });
    assert.deepEqual([result.status, result.body.error], [status, error]);
  }
});

const UPLOAD = `uploads/${'11111111-1111-4111-8111-111111111111'}/${'22222222-2222-4222-8222-222222222222'}.png`;

test('an uploaded still goes to the generation route as an upload reference, before any Library asset, with consent (ADR-0100 amendment 6)', async () => {
  const model = { ...VIDEO, capabilities: { media: { image: { maxFiles: 1 }, endImage: { maxFiles: 1 } } } };
  const { result, calls } = await video({ ...ARGS, consent: true, source_assets: [{ asset_id: ASSET, slot: 'endImage' }], source_uploads: [{ key: UPLOAD, slot: 'image', url: 'https://evil.example/x.png' }] }, { model });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.create[0].references, [{ key: UPLOAD, slot: 'image', origin: 'upload' }, { asset_id: ASSET, slot: 'endImage', origin: 'asset' }]);
  assert.equal(calls.create[0].consent, true);
});

test('an upload needs consent, a key this connector could have reserved and a slot of the file\'s kind, and counts against the slot cap', async () => {
  const cases = [
    [{ source_uploads: [{ key: UPLOAD, slot: 'image' }] }, 'consent_required'],
    [{ consent: true, source_uploads: [{ key: 'uploads/11111111-1111-4111-8111-111111111111/not-a-uuid.png', slot: 'image' }] }, 'source_upload_invalid'],
    [{ consent: true, source_uploads: [{ key: UPLOAD, slot: 'video' }] }, 'source_upload_kind_mismatch'],
    [{ consent: true, source_uploads: [{ key: UPLOAD, slot: 'image' }], source_assets: [{ asset_id: ASSET, slot: 'image' }] }, 'source_count_exceeded'],
  ];
  for (const [extra, error] of cases) {
    const { result, calls } = await video({ ...ARGS, ...extra });
    assert.deepEqual([result.status, result.body.error, calls.create.length], [400, error, 0], error);
  }
});
