import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { KLING_V3_PROMPT_MAX } from '../lib/generationPromptLimits.js';
import { capabilityFor, checkInputs, publicCapabilities } from '../lib/modelCapabilities.js';
import { fallbackCapabilitiesFor } from '../lib/fallbackModelCapabilities.js';
import { templateContract } from '../lib/templateContract.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test' });
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const ENDPOINTS = ['fal-ai/kling-video/v3/pro/image-to-video', 'fal-ai/kling-video/v3/standard/image-to-video'];

test('the cap is one named constant and both Kling 3.0 image-to-video endpoints use it', () => {
  assert.equal(KLING_V3_PROMPT_MAX, 2500);
  for (const endpoint of ENDPOINTS) {
    assert.equal(capabilityFor(endpoint).inputs.prompt.max, KLING_V3_PROMPT_MAX);
    assert.equal(publicCapabilities(capabilityFor(endpoint)).inputs.prompt.max, KLING_V3_PROMPT_MAX);
  }
  assert.equal(fallbackCapabilitiesFor('kling-3.0-i2v').inputs.prompt.max, KLING_V3_PROMPT_MAX);
});

test('the model contract accepts exactly the cap and refuses one character more, typed', () => {
  const record = capabilityFor(ENDPOINTS[0]);
  assert.equal(checkInputs(record, { prompt: 'x'.repeat(KLING_V3_PROMPT_MAX), image_url: 'https://x.test/a.png' }).error, undefined);
  assert.deepEqual(checkInputs(record, { prompt: 'x'.repeat(KLING_V3_PROMPT_MAX + 1) }), { ok: false, error: 'inputs_invalid:prompt' });
});

test('no usable Kling 3.0 template exceeds the cap, and every over-cap one is classed unsupported for prompt-limit', () => {
  let usable = 0, refused = 0;
  for (const preset of PRESETS) {
    const c = templateContract(preset.id);
    if (!c || !c.allowedModels.includes('kling-3.0-i2v')) continue;
    if (['like-for-like-safe', 'bound'].includes(c.class)) { usable++; assert.ok(c.prompt.length <= KLING_V3_PROMPT_MAX, `${c.id} ${c.prompt.length}`); }
    else if (c.reasons.includes('prompt-limit') && c.class === 'unsupported') refused++;
  }
  assert.ok(usable > 200);
  assert.ok(refused > 0);
});

test('a 3,000-character prompt on Kling 3.0 is a typed 400 with no job lookup write and no ledger row', async (t) => {
  const calls = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
    const url = new URL(String(target)); calls.push(url.pathname);
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{ id: 'kling-3.0-i2v', provider: 'fal', provider_endpoint: ENDPOINTS[0], modality: 'image-to-video', credits_5s: 64, active: true, gated_flag: false }]);
    if (url.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
    if (url.pathname === '/rest/v1/jobs') return Response.json([]);
    if (url.pathname.includes('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
    throw new Error(`Unexpected request ${url.hostname}${url.pathname}`);
  });
  const res = await POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST',
    headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: 'kling-3.0-i2v', idempotency_key: ['kling', 'cap', 'probe', '1'].join('-'), inputs: { prompt: 'x'.repeat(3000) } }) }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'inputs_invalid:prompt');
  assert.equal(calls.some(p => /ledger_|admit_fal|submit_free_job/.test(p)), false, calls.join(','));
});
