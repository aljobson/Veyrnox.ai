import test from 'node:test';
import assert from 'node:assert/strict';
import { startMcpGeneration } from '../lib/mcpGenerate.js';

const IMAGE = { id: 'flux-2-pro-1k-kie', modality: 'text-to-image', credits: 2, durations: [5] };
const ARGS = { model_id: IMAGE.id, prompt: 'A plain grey mannequin head', confirmed_credits: 2, user_approved: true, idempotency_key: 'mcp-trial-0001' };

// Every dependency is a fake that records its calls, so a test can prove what did NOT happen.
function harness({ model = IMAGE, created = { status: 202, body: { job_id: 'new-job', state: 'queued' } }, catalogFails = false } = {}) {
  const calls = { catalog: 0, create: [] };
  return {
    calls,
    deps: {
      async findModel(id) { calls.catalog++; if (catalogFails) throw new Error('down'); return id === model?.id ? model : undefined; },
      async createGeneration(body) { calls.create.push(body); return { response: { ok: created.status < 400, status: created.status }, data: created.body }; },
    },
  };
}
const run = async (args, options) => { const h = harness(options); const result = await startMcpGeneration(args, h.deps); return { ...h, result }; };

test('a confirmed image generation within the limits is sent once to the generation route, with nothing else added', async () => {
  const { result, calls } = await run({ ...ARGS, negative_prompt: 'text', aspect_ratio: '16:9', seed: 7 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { job_id: 'new-job', state: 'queued' });
  assert.equal(calls.create.length, 1);
  assert.deepEqual(calls.create[0], {
    model_id: IMAGE.id, idempotency_key: 'mcp-trial-0001', confirmed_credits: 2,
    inputs: { prompt: 'A plain grey mannequin head', negative_prompt: 'text', aspect_ratio: '16:9', seed: 7 },
    references: [], consent: false,
  });
});

test('undefined optional inputs are dropped and unknown keys never reach the route', async () => {
  const { calls } = await run({ ...ARGS, seed: undefined, source_asset_ids: ['x'], consent: true, duration_seconds: 10, model_id_override: 'video' });
  assert.deepEqual(calls.create[0].inputs, { prompt: 'A plain grey mannequin head' });
  assert.deepEqual(calls.create[0].references, []);
  assert.equal(calls.create[0].consent, false);
});

test('only text-to-image models may be started without a source, and nothing else is read or sent', async () => {
  for (const modality of ['text-to-video', 'image-to-video', 'text-to-audio', 'image-to-image', 'audio-to-audio', 'text', undefined]) {
    const { result, calls } = await run(ARGS, { model: { ...IMAGE, modality } });
    assert.equal(result.ok, false, String(modality));
    assert.equal(result.status, 400); assert.equal(result.body.error, 'mcp_image_only');
    assert.equal(calls.create.length, 0, `${modality}: no spend`);
  }
});

test('without the user\'s approval nothing is sent, even with the right price', async () => {
  for (const user_approved of [undefined, false, 'true', 1]) {
    const { result, calls } = await run({ ...ARGS, user_approved });
    assert.deepEqual([result.ok, result.status, result.body.error, calls.create.length], [false, 400, 'approval_required', 0], String(user_approved));
  }
});

test('there is no per-call price cap: a dear image model is allowed at its exact price', async () => {
  const { result, calls } = await run({ ...ARGS, confirmed_credits: 40 }, { model: { ...IMAGE, credits: 40 } });
  assert.equal(result.ok, true);
  assert.equal(calls.create[0].confirmed_credits, 40);
});

test('the confirmed price must equal the live price exactly; any difference is a refusal with no spend', async () => {
  for (const confirmed of [0, 1, 3, 100]) {
    const { result, calls } = await run({ ...ARGS, confirmed_credits: confirmed });
    assert.deepEqual([result.ok, result.status, result.body.error, result.body.expected_credits, result.body.confirmed_credits], [false, 409, 'credit_confirmation_mismatch', 2, confirmed]);
    assert.equal(calls.create.length, 0, `confirmed ${confirmed}`);
  }
});

test('an unknown model and an unavailable catalog are refused cleanly', async () => {
  const unknown = await run({ ...ARGS, model_id: 'nope-1' });
  assert.deepEqual([unknown.result.status, unknown.result.body.error, unknown.calls.create.length], [404, 'model_not_found', 0]);
  const down = await run(ARGS, { catalogFails: true });
  assert.deepEqual([down.result.status, down.result.body.error, down.calls.create.length], [503, 'catalog_unavailable', 0]);
});

test('there is no daily cap: a call is never refused for how much the account spent recently', async () => {
  const { result, calls } = await run(ARGS);
  assert.equal(result.ok, true);
  assert.equal(calls.create.length, 1);
});

test('a refusal from the generation route is passed through untouched, so its own checks stay authoritative', async () => {
  for (const status of [400, 402, 409, 429, 502]) {
    const { result } = await run(ARGS, { created: { status, body: { error: 'insufficient_credits' } } });
    assert.deepEqual([result.ok, result.status, result.body], [false, status, { error: 'insufficient_credits' }]);
  }
});


const UPLOAD_KEY = `uploads/${'11111111-1111-4111-8111-111111111111'}/${'22222222-2222-4222-8222-222222222222'}.png`;
const EDIT = { ...IMAGE, id: 'topaz-upscale', modality: 'image-to-image', credits: 5, capabilities: { media: { image: { required: true, maxFiles: 1 } } } };

test('an uploaded file reaches an image-to-image model as an ordered upload reference, with consent (ADR-0100 amendment 6)', async () => {
  const { result, calls } = await run({ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, consent: true, source_uploads: [{ key: UPLOAD_KEY, slot: 'image', url: 'https://evil.example/x.png' }] }, { model: EDIT });
  assert.equal(result.ok, true);
  assert.deepEqual([calls.create[0].references, calls.create[0].consent], [[{ key: UPLOAD_KEY, slot: 'image', origin: 'upload' }], true]);
});

test('an upload needs consent, a key of the right shape and kind, and a model with an image slot; nothing is sent otherwise', async () => {
  const cases = [
    [{ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, source_uploads: [{ key: UPLOAD_KEY, slot: 'image' }] }, EDIT, 'consent_required'],
    [{ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, consent: true, source_uploads: [{ key: 'uploads/../../etc/passwd', slot: 'image' }] }, EDIT, 'source_upload_invalid'],
    [{ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, consent: true, source_uploads: [{ key: UPLOAD_KEY.replace(/png$/, 'mp4'), slot: 'image' }] }, EDIT, 'source_upload_kind_mismatch'],
    [{ ...ARGS, consent: true, source_uploads: [{ key: UPLOAD_KEY, slot: 'image' }] }, IMAGE, 'source_slot_invalid'],
    [{ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, consent: true, source_uploads: [{ key: UPLOAD_KEY, slot: 'image' }, { key: UPLOAD_KEY, slot: 'image' }] }, EDIT, 'source_count_exceeded'],
  ];
  for (const [args, model, error] of cases) {
    const { result, calls } = await run(args, { model });
    assert.deepEqual([result.ok, result.status, result.body.error, calls.create.length], [false, 400, error, 0], error);
  }
});

test('a text-to-image model with an image slot may take an uploaded reference too', async () => {
  const model = { ...IMAGE, capabilities: { media: { image: { maxFiles: 1 } } } };
  const { result, calls } = await run({ ...ARGS, consent: true, source_uploads: [{ key: UPLOAD_KEY, slot: 'image' }] }, { model });
  assert.equal(result.ok, true);
  assert.equal(calls.create[0].references.length, 1);
});

test('an image-to-image model stays unreachable without an upload: the route would have nothing to edit', async () => {
  const { result, calls } = await run({ ...ARGS, model_id: EDIT.id, confirmed_credits: 5, consent: true, source_uploads: [] }, { model: EDIT });
  assert.deepEqual([result.status, result.body.error, calls.create.length], [400, 'mcp_image_only', 0]);
});
