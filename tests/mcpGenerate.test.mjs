import test from 'node:test';
import assert from 'node:assert/strict';
import { MCP_GENERATION_LIMITS, startMcpGeneration } from '../lib/mcpGenerate.js';

const IMAGE = { id: 'flux-2-pro-1k-kie', modality: 'text-to-image', credits: 2, durations: [5] };
const ARGS = { model_id: IMAGE.id, prompt: 'A plain grey mannequin head', confirmed_credits: 2, idempotency_key: 'mcp-trial-0001' };

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
    source_assets: [], consent: false,
  });
});

test('undefined optional inputs are dropped and unknown keys never reach the route', async () => {
  const { calls } = await run({ ...ARGS, seed: undefined, source_asset_ids: ['x'], consent: true, duration_seconds: 10, model_id_override: 'video' });
  assert.deepEqual(calls.create[0].inputs, { prompt: 'A plain grey mannequin head' });
  assert.deepEqual(calls.create[0].source_assets, []);
  assert.equal(calls.create[0].consent, false);
});

test('only text-to-image models may be started from the connector, and nothing else is read or sent', async () => {
  for (const modality of ['text-to-video', 'image-to-video', 'text-to-audio', 'image-to-image', 'audio-to-audio', 'text', undefined]) {
    const { result, calls } = await run(ARGS, { model: { ...IMAGE, modality } });
    assert.equal(result.ok, false, String(modality));
    assert.equal(result.status, 400); assert.equal(result.body.error, 'mcp_image_only');
    assert.equal(calls.create.length, 0, `${modality}: no spend`);
  }
});

test('a model dearer than the per-call limit is refused before any spend', async () => {
  const { result, calls } = await run({ ...ARGS, confirmed_credits: 3 }, { model: { ...IMAGE, credits: 3 } });
  assert.deepEqual([result.ok, result.status, result.body.error, result.body.max_credits_per_call, result.body.expected_credits], [false, 400, 'mcp_price_cap', 2, 3]);
  assert.equal(calls.create.length, 0);
  const exact = await run({ ...ARGS, confirmed_credits: 2 }, { model: { ...IMAGE, credits: MCP_GENERATION_LIMITS.maxCreditsPerCall } });
  assert.equal(exact.result.ok, true, 'a model at exactly the limit is allowed');
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

test('the per-call limit is small, fixed and frozen, and there is no daily cap setting', () => {
  assert.deepEqual({ ...MCP_GENERATION_LIMITS }, { maxCreditsPerCall: 2 });
  assert.ok(Object.isFrozen(MCP_GENERATION_LIMITS));
});
