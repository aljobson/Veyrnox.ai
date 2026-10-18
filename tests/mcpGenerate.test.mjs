import test from 'node:test';
import assert from 'node:assert/strict';
import { MCP_GENERATION_LIMITS, creditsSpentInWindow, startMcpGeneration } from '../lib/mcpGenerate.js';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();
const IMAGE = { id: 'flux-2-pro-1k-kie', modality: 'text-to-image', credits: 2, durations: [5] };
const job = (over = {}) => ({ job_id: '00000000-0000-4000-8000-000000000001', state: 'succeeded', refunded: false, credits: 2, created_at: ago(1), ...over });
const ARGS = { model_id: IMAGE.id, prompt: 'A plain grey mannequin head', confirmed_credits: 2, idempotency_key: 'mcp-trial-0001' };

// Every dependency is a fake that records its calls, so a test can prove what did NOT happen.
function harness({ model = IMAGE, jobs = [], jobsStatus = 200, created = { status: 202, body: { job_id: 'new-job', state: 'queued' } }, catalogFails = false } = {}) {
  const calls = { catalog: 0, jobs: 0, create: [] };
  return {
    calls,
    deps: {
      now: () => NOW,
      async findModel(id) { calls.catalog++; if (catalogFails) throw new Error('down'); return id === model?.id ? model : undefined; },
      async readRecentJobs() { calls.jobs++; return { response: { ok: jobsStatus === 200, status: jobsStatus }, data: jobsStatus === 200 ? { jobs } : { error: 'nope' } }; },
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
    assert.deepEqual([calls.jobs, calls.create.length], [0, 0], `${modality}: no job read, no spend`);
  }
});

test('a model dearer than the per-call limit is refused before any spend check', async () => {
  const { result, calls } = await run({ ...ARGS, confirmed_credits: 3 }, { model: { ...IMAGE, credits: 3 } });
  assert.deepEqual([result.ok, result.status, result.body.error, result.body.max_credits_per_call, result.body.expected_credits], [false, 400, 'mcp_price_cap', 2, 3]);
  assert.deepEqual([calls.jobs, calls.create.length], [0, 0]);
  const exact = await run({ ...ARGS, confirmed_credits: 2 }, { model: { ...IMAGE, credits: MCP_GENERATION_LIMITS.maxCreditsPerCall } });
  assert.equal(exact.result.ok, true, 'a model at exactly the limit is allowed');
});

test('the confirmed price must equal the live price exactly; any difference is a refusal with no spend', async () => {
  for (const confirmed of [0, 1, 3, 100]) {
    const { result, calls } = await run({ ...ARGS, confirmed_credits: confirmed });
    assert.deepEqual([result.ok, result.status, result.body.error, result.body.expected_credits, result.body.confirmed_credits], [false, 409, 'credit_confirmation_mismatch', 2, confirmed]);
    assert.deepEqual([calls.jobs, calls.create.length], [0, 0], `confirmed ${confirmed}`);
  }
});

test('an unknown model and an unavailable catalog are refused cleanly', async () => {
  const unknown = await run({ ...ARGS, model_id: 'nope-1' });
  assert.deepEqual([unknown.result.status, unknown.result.body.error, unknown.calls.create.length], [404, 'model_not_found', 0]);
  const down = await run(ARGS, { catalogFails: true });
  assert.deepEqual([down.result.status, down.result.body.error, down.calls.create.length], [503, 'catalog_unavailable', 0]);
});

test('creditsSpentInWindow counts the last 24 hours, skips refunded and older jobs, and fails closed on a bad date', () => {
  const jobs = [job({ credits: 2, created_at: ago(1) }), job({ credits: 5, created_at: ago(23.9) }), job({ credits: 9, created_at: ago(24.1) }), job({ credits: 4, refunded: true, state: 'failed', created_at: ago(2) }), job({ credits: 3, created_at: 'not a date' })];
  assert.deepEqual(creditsSpentInWindow(jobs, NOW), { spent: 2 + 5 + 3, complete: true });
  assert.deepEqual(creditsSpentInWindow([], NOW), { spent: 0, complete: true });
  assert.equal(creditsSpentInWindow([job({ credits: 'x' })], NOW).spent, 0, 'a non-numeric charge counts as nothing, never as NaN');
});

test('a full page whose oldest job is still inside the window cannot prove the total, so it is not complete', () => {
  const page = Array.from({ length: MCP_GENERATION_LIMITS.jobsPageSize }, (_, i) => job({ credits: 0, created_at: ago(0.5 + i * 0.01) }));
  assert.equal(creditsSpentInWindow(page, NOW).complete, false);
  const older = [...page.slice(0, -1), job({ credits: 0, created_at: ago(30) })];
  assert.equal(creditsSpentInWindow(older, NOW).complete, true, 'a page that reaches past 24 hours is conclusive');
});

test('the daily cap allows spending up to exactly the cap and refuses one credit more', async () => {
  const cap = MCP_GENERATION_LIMITS.dailyCreditCap;
  const under = await run(ARGS, { jobs: [job({ credits: cap - 2 })] });
  assert.equal(under.result.ok, true, 'spent 38 + 2 = 40 is allowed');
  const over = await run(ARGS, { jobs: [job({ credits: cap - 1 })] });
  assert.deepEqual([over.result.ok, over.result.status, over.result.body.error, over.result.body.spent_last_24h, over.result.body.daily_cap], [false, 429, 'mcp_daily_cap_reached', cap - 1, cap]);
  assert.equal(over.calls.create.length, 0);
});

test('refunded and old jobs do not use up the daily allowance', async () => {
  const { result } = await run(ARGS, { jobs: [job({ credits: 40, refunded: true, state: 'failed' }), job({ credits: 40, created_at: ago(25) })] });
  assert.equal(result.ok, true);
});

test('if the recent jobs cannot be read, or the page is too full to prove the total, nothing is spent', async () => {
  const down = await run(ARGS, { jobsStatus: 503 });
  assert.deepEqual([down.result.ok, down.result.status, down.result.body.error, down.calls.create.length], [false, 503, 'spend_check_unavailable', 0]);
  const full = Array.from({ length: MCP_GENERATION_LIMITS.jobsPageSize }, (_, i) => job({ credits: 0, created_at: ago(0.1 + i * 0.01) }));
  const unproven = await run(ARGS, { jobs: full });
  assert.deepEqual([unproven.result.ok, unproven.result.status, unproven.result.body.error, unproven.calls.create.length], [false, 429, 'mcp_daily_cap_unverifiable', 0]);
});

test('a refusal from the generation route is passed through untouched, so its own checks stay authoritative', async () => {
  for (const status of [400, 402, 409, 429, 502]) {
    const { result } = await run(ARGS, { created: { status, body: { error: 'insufficient_credits' } } });
    assert.deepEqual([result.ok, result.status, result.body], [false, status, { error: 'insufficient_credits' }]);
  }
});

test('the limits are small, fixed and frozen', () => {
  assert.deepEqual({ ...MCP_GENERATION_LIMITS }, { maxCreditsPerCall: 2, dailyCreditCap: 40, windowMs: 86400000, jobsPageSize: 50 });
  assert.ok(Object.isFrozen(MCP_GENERATION_LIMITS));
});
